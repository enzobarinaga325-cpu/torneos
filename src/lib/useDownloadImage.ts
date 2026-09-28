import { useRef, useState } from "react";

const MAX_OUTPUT_HEIGHT = 4000; // límite de canvas seguro para navegadores de celular (sobre todo iOS)
const SAFE_MAX_CAPTURE_HEIGHT = 8000; // idem, para el canvas intermedio cuando se usa `fixedSize`

export interface FixedSize {
  width: number;
  height: number;
  /** Color de fondo para el sobrante cuando el contenido capturado es más bajo que `height`. */
  fallbackColor: string;
}

/**
 * Captura el contenido de `ref` como PNG y lo descarga. Reutilizado por cualquier vista
 * "para compartir". Usa html2canvas (dibuja el DOM directo a un canvas) en vez de
 * html-to-image (que serializa a un SVG con foreignObject) — esta última tenía un bug real
 * con layouts flexbox anidados: la tarjeta quedaba con contenido solo en la mitad
 * izquierda y la derecha en blanco, algo invisible en pruebas simples pero muy notorio en
 * un cartel real con varias canchas y partidos.
 *
 * Si se pasa `fixedSize`, la imagen final sale siempre exactamente a esa resolución (por
 * ejemplo 1080x1920, formato Historia de Instagram) sin importar cuánto contenido tenga
 * adentro: si entra entero se pega arriba y el resto se rellena con `fallbackColor`; si es
 * más alto de lo que entra, se achica completo (sin recortar nada) y se centra. Sin
 * `fixedSize` (el caso de tablas/brackets, que no tienen un formato fijo) se mantiene el
 * comportamiento anterior: la imagen sale al alto natural del contenido.
 */
export function useDownloadImage(fileName: string, fixedSize?: FixedSize) {
  const ref = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  async function download() {
    const node = ref.current;
    if (!node) return;
    setDownloading(true);
    try {
      // Se importa recién acá (no arriba del archivo) para que html2canvas-pro -- una
      // librería pesada que solo hace falta al tocar "Descargar imagen" -- no viaje en el
      // bundle principal para todo el mundo que nunca usa esta función.
      const { default: html2canvas } = await import("html2canvas-pro");

      // Si alguna <img> todavía no terminó de cargar, el alto que se mide queda corto y se
      // exporta solo la parte de arriba — hay que esperarlas.
      const imgs = Array.from(node.querySelectorAll("img"));
      await Promise.all(
        imgs.map((img) => (img.complete ? Promise.resolve() : new Promise((res) => { img.onload = res; img.onerror = res; }))),
      );

      let canvas: HTMLCanvasElement;

      if (fixedSize) {
        const naturalWidth = node.clientWidth;
        const naturalHeight = node.scrollHeight;
        const targetHeightAtNaturalWidth = naturalWidth * (fixedSize.height / fixedSize.width);

        let captureNode: HTMLElement = node;
        let removeClone: (() => void) | null = null;
        let effectiveHeight = naturalHeight; // alto ya achicado (si aplicó el clon) para el tope de seguridad de abajo

        if (naturalHeight > targetHeightAtNaturalWidth) {
          // El contenido no entra al ancho natural (un día con muchos partidos) -- en vez de
          // achicar la imagen entera y dejar barras vacías a los costados, se clona el cartel
          // fuera de pantalla, se lo ensancha y se lo achica con un transform en la misma
          // proporción: al ensanchar, el texto ocupa menos líneas (reduce el alto natural por
          // su cuenta) y al achicar por igual ancho y alto, el resultado visual vuelve a
          // ocupar el ancho original -- sin recortar ningún partido y sin deformar las letras
          // (si solo se comprimiera el alto, el texto saldría aplastado).
          const shrink = targetHeightAtNaturalWidth / naturalHeight;
          const clone = node.cloneNode(true) as HTMLElement;
          clone.style.width = `${naturalWidth / shrink}px`;
          clone.style.maxWidth = "none";
          clone.style.transformOrigin = "top left";
          clone.style.transform = `scale(${shrink})`;
          const wrapper = document.createElement("div");
          wrapper.style.cssText = "position:fixed;left:-99999px;top:0;";
          wrapper.appendChild(clone);
          document.body.appendChild(wrapper);
          captureNode = clone;
          removeClone = () => wrapper.remove();
          effectiveHeight = targetHeightAtNaturalWidth;
        }

        // Se captura siempre al ancho físico exacto pedido (ej. 1080px), sea cual sea el
        // ancho real en pantalla, así sale nítido tanto en celular como en compu.
        const scale = Math.min(fixedSize.width / naturalWidth, SAFE_MAX_CAPTURE_HEIGHT / effectiveHeight);
        const captured = await html2canvas(captureNode, { backgroundColor: fixedSize.fallbackColor, scale, useCORS: true });
        removeClone?.();

        canvas = document.createElement("canvas");
        canvas.width = fixedSize.width;
        canvas.height = fixedSize.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = fixedSize.fallbackColor;
        ctx.fillRect(0, 0, fixedSize.width, fixedSize.height);

        const heightAtTargetWidth = captured.height * (fixedSize.width / captured.width);
        if (heightAtTargetWidth <= fixedSize.height) {
          ctx.drawImage(captured, 0, 0, captured.width, captured.height, 0, 0, fixedSize.width, heightAtTargetWidth);
        } else {
          const fitScale = fixedSize.height / captured.height;
          const destWidth = captured.width * fitScale;
          ctx.drawImage(captured, 0, 0, captured.width, captured.height, (fixedSize.width - destWidth) / 2, 0, destWidth, fixedSize.height);
        }
      } else {
        // Los navegadores de celular (sobre todo iOS) tienen un límite de tamaño de canvas
        // bastante más chico que en la compu — un cartel muy alto a escala fija 2x lo
        // podía superar. Se limita la escala para que el canvas final nunca pase de cierto
        // alto, sea cual sea el dispositivo.
        const scale = Math.min(2, MAX_OUTPUT_HEIGHT / node.scrollHeight) || 1;
        canvas = await html2canvas(node, { backgroundColor: "#ffffff", scale, useCORS: true });
      }

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) return;
      const file = new File([blob], `${fileName}.png`, { type: "image/png" });

      // En celular (sobre todo iOS) no hay un "guardar como" tradicional para un blob
      // descargado — el menú nativo de compartir sí permite elegir "Guardar imagen" y que
      // quede en Fotos, así que se prioriza eso cuando el navegador lo soporta.
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") return; // el usuario cerró el menú sin elegir nada
          throw err;
        }
        return;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileName}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  return { ref, download, downloading };
}
