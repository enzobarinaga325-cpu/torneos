import { useRef, useState } from "react";

export interface StorySize {
  width: number;
  height: number;
  fallbackColor: string;
  /** Fondo de la tarjeta (ej. la foto de la cancha), dibujado directo en el canvas final. */
  backgroundImageUrl: string;
}

/**
 * Clona `el` fuera de pantalla (a `document.body`, sin ningún ancestro con `transform`) y le
 * fija el ancho explícito que tenía en vivo, ya perdido al clonarlo sin su padre real --
 * `html2canvas` calcula mal el texto de un elemento que vive dentro de un ancestro con
 * `transform: scale()` (lo superpone), así que nunca se captura el elemento en vivo
 * directamente, siempre este clon aislado.
 */
function cloneOffscreen(el: HTMLElement, widthPx: number, extraTransform?: string): { clone: HTMLElement; cleanup: () => void } {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.style.width = `${widthPx}px`;
  clone.style.maxWidth = "none";
  if (extraTransform) {
    clone.style.transformOrigin = "top left";
    clone.style.transform = extraTransform;
  }
  const wrapper = document.createElement("div");
  wrapper.style.cssText = "position:fixed;left:-99999px;top:0;";
  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);
  return { clone, cleanup: () => wrapper.remove() };
}

/**
 * Como `useDownloadImage`, pero pensado para un cartel de 3 partes apiladas -- encabezado
 * (logo/título, tamaño fijo), contenido (la lista de partidos, la única parte que puede
 * variar según cuántos partidos haya) y pie -- que se exporta siempre a una resolución
 * exacta (ej. 1080x1920, formato Historia de Instagram).
 *
 * Achicar la tarjeta ENTERA como un solo bloque (la primera versión de esto) tenía un
 * problema: el encabezado usa paddings en % para que el logo del fondo quede bien a
 * cualquier ancho, así que al ensanchar todo el bloque para comprimirlo, el encabezado
 * también se ensanchaba y su padding crecía con él -- se comía el espacio que se suponía
 * que había que ganar. Acá el encabezado y el pie se capturan siempre a su tamaño natural
 * (con fondo transparente), y sólo el contenido (la lista de partidos) se ensancha-y-achica
 * si hace falta para que todo entre en el alto disponible. La imagen de fondo se dibuja
 * aparte, directo en el canvas final, así siempre cubre los 1920px de alto sin depender del
 * tamaño real de ninguna de las tres partes.
 */
/** Espera al siguiente frame pintado -- usado para darle tiempo al navegador de acomodar
 * layout recién insertado antes de pedirle a html2canvas que lo capture. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Una captura vacía (0x0) es la forma más común en que esto sale mal -- pasa sobre todo en
 * el celular, cuando html2canvas arranca a capturar el clon recién insertado antes de que el
 * navegador termine de acomodarle el layout. Se detecta así en vez de intentar adivinar por
 * qué salió mal, y el llamador decide reintentar. */
function assertCaptured(canvas: HTMLCanvasElement, label: string) {
  if (canvas.width === 0 || canvas.height === 0) throw new Error(`captura vacía: ${label}`);
}

export function useStoryDownload(fileName: string, size: StorySize) {
  const headerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  async function captureOnce(): Promise<"ok" | "aborted"> {
    const headerEl = headerRef.current;
    const contentEl = contentRef.current;
    const footerEl = footerRef.current;
    if (!headerEl || !contentEl || !footerEl) return "ok";

    const { default: html2canvas } = await import("html2canvas-pro");

    // Si la tipografía (ej. Manrope, cargada de Google Fonts) todavía no terminó de
    // descargarse, html2canvas la captura con la fuente de sistema de reemplazo -- se
    // espera a que el navegador confirme que ya está lista para usarse.
    await document.fonts.ready;

    const imgs = [headerEl, contentEl, footerEl].flatMap((el) => Array.from(el.querySelectorAll("img")));
    await Promise.all(
      imgs.map((img) => (img.complete ? Promise.resolve() : new Promise((res) => { img.onload = res; img.onerror = res; }))),
    );

    // El ancho "real" se lee ACÁ, con los elementos todavía en vivo -- clientWidth no se
    // ve afectado por ningún `transform` que tenga un ancestro (ej. el que escala la
    // tarjeta para que entre en pantallas angostas), así que da siempre el ancho de
    // diseño real sea cual sea el tamaño en pantalla.
    const cardWidth = headerEl.clientWidth;
    const scale = size.width / cardWidth;
    const captureOpts = { backgroundColor: null, scale, useCORS: true } as const;

    const header = cloneOffscreen(headerEl, cardWidth);
    await nextFrame();
    const headerCanvas = await html2canvas(header.clone, captureOpts);
    header.cleanup();
    assertCaptured(headerCanvas, "encabezado");

    const footer = cloneOffscreen(footerEl, cardWidth);
    await nextFrame();
    const footerCanvas = await html2canvas(footer.clone, captureOpts);
    footer.cleanup();
    assertCaptured(footerCanvas, "pie");

    const budgetForContent = size.height - headerCanvas.height - footerCanvas.height;
    const contentNaturalWidth = contentEl.clientWidth;
    const contentNaturalHeight = contentEl.scrollHeight;

    let contentCanvas: HTMLCanvasElement;
    if (contentNaturalHeight * scale <= budgetForContent) {
      const content = cloneOffscreen(contentEl, contentNaturalWidth);
      await nextFrame();
      contentCanvas = await html2canvas(content.clone, captureOpts);
      content.cleanup();
    } else {
      // No entra tal cual -- se ensancha y se achica con un transform en la misma
      // proporción: el texto reordena en menos líneas al ensancharse, así el resultado
      // visual vuelve a ocupar el ancho original pero más compacto, sin recortar ningún
      // partido ni deformar las letras.
      const shrink = (budgetForContent / scale) / contentNaturalHeight;
      const content = cloneOffscreen(contentEl, contentNaturalWidth / shrink, `scale(${shrink})`);
      await nextFrame();
      contentCanvas = await html2canvas(content.clone, captureOpts);
      content.cleanup();
    }
    assertCaptured(contentCanvas, "contenido");

    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no se pudo crear el canvas final");

    ctx.fillStyle = size.fallbackColor;
    ctx.fillRect(0, 0, size.width, size.height);

    const bg = await loadImage(size.backgroundImageUrl);
    const bgHeightAtWidth = bg.height * (size.width / bg.width);
    ctx.drawImage(bg, 0, 0, bg.width, bg.height, 0, 0, size.width, bgHeightAtWidth);

    let y = 0;
    ctx.drawImage(headerCanvas, 0, y);
    y += headerCanvas.height;
    const contentDrawHeight = Math.min(contentCanvas.height, size.height - y);
    ctx.drawImage(contentCanvas, 0, 0, contentCanvas.width, contentDrawHeight, 0, y, size.width, contentDrawHeight);
    y += contentDrawHeight;
    if (y < size.height) {
      const footerDrawHeight = Math.min(footerCanvas.height, size.height - y);
      ctx.drawImage(footerCanvas, 0, 0, footerCanvas.width, footerDrawHeight, 0, y, size.width, footerDrawHeight);
    }

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("no se pudo generar el archivo final");
    const file = new File([blob], `${fileName}.png`, { type: "image/png" });

    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return "aborted"; // el usuario cerró el menú de compartir sin elegir nada
        throw err;
      }
      return "ok";
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName}.png`;
    // El navegador lee el blob en segundo plano después de este click -- si justo venía de
    // generar una imagen pesada (como esta grilla) y el sistema está ocupado, revocar la
    // URL en la línea siguiente corta esa lectura a mitad de camino y la descarga sale
    // rota o vacía. Se espera un poco antes de revocar para darle tiempo a terminar de leerla.
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return "ok";
  }

  // El celular (sobre todo con poca señal en la cancha) es donde más se veía esto salir mal
  // -- una captura vacía por timing, o el archivo compartido salía corrupto. En vez de que
  // el usuario tenga que tocar "Descargar" varias veces a mano hasta que uno saliera bien,
  // un solo toque reintenta solo unas pocas veces antes de avisar que algo falló de verdad.
  async function download() {
    setDownloading(true);
    try {
      let lastError: unknown;
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          const result = await captureOnce();
          if (result === "aborted") return;
          return;
        } catch (err) {
          lastError = err;
          if (attempt < 4) await new Promise((r) => setTimeout(r, 400));
        }
      }
      console.error("useStoryDownload: no se pudo generar la imagen después de varios intentos", lastError);
      alert("No se pudo generar la imagen. Probá de nuevo en un momento.");
    } finally {
      setDownloading(false);
    }
  }

  return { headerRef, contentRef, footerRef, download, downloading };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`no se pudo cargar la imagen de fondo: ${src}`));
    img.src = src;
  });
}
