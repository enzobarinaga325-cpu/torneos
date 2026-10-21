/**
 * html2canvas no dibuja el elemento en vivo: arma una copia de TODA la página dentro de un
 * iframe oculto y captura esa copia. Las hojas de estilo enlazadas con `<link>` (el CSS de
 * Tailwind que genera Vite, Google Fonts) se copian como `<link>`, así que el iframe las
 * vuelve a pedir por la red -- y html2canvas NO espera a que terminen de llegar: da el iframe
 * por listo apenas existe y captura igual.
 *
 * En la compu el CSS sale de la caché al instante y no se nota. En el celular, sobre todo con
 * poca señal en la cancha, la captura se hacía con el iframe todavía sin estilos: letra Times,
 * sin grilla ni tarjetas, todo apilado a la izquierda y en tamaño por defecto. Sólo
 * sobrevivían los estilos escritos en línea (`style={...}`), que viajan pegados a cada nodo.
 *
 * Esta función va como `onclone` de html2canvas y lo resuelve sin depender de la red:
 * 1. cada `<link>` cuyo CSS ya está cargado en la página real (el propio, mismo origen) se
 *    reemplaza por un `<style>` con ese mismo CSS en texto -- se aplica en el acto;
 * 2. los que no se pueden leer así (Google Fonts, otro origen) se esperan hasta que carguen;
 * 3. se esperan las tipografías que la página real ya tenía listas (ej. Manrope).
 * Los pasos 2 y 3 tienen un tope de tiempo: si la red no responde, se captura igual con lo
 * que haya, en vez de colgar el botón de descarga.
 */
export async function prepareClonedDocument(clonedDoc: Document): Promise<void> {
  const links = Array.from(clonedDoc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]'));
  const pending: Promise<void>[] = [];

  for (const link of links) {
    const css = readLoadedCss(link.href);
    if (css !== null) {
      const style = clonedDoc.createElement("style");
      if (link.media) style.media = link.media;
      style.textContent = css;
      link.replaceWith(style);
    } else if (!link.sheet) {
      pending.push(waitForLink(link));
    }
  }
  await withTimeout(Promise.all(pending), 4000);

  const loadedFaces = Array.from(document.fonts).filter((f) => f.status === "loaded");
  await withTimeout(
    Promise.all(
      loadedFaces.map((f) =>
        clonedDoc.fonts.load(`${f.style} ${f.weight} 16px "${f.family.replace(/["']/g, "")}"`).catch(() => undefined),
      ),
    ),
    4000,
  );
}

/** El texto del CSS que la página real ya cargó desde `href`, o null si no se puede leer
 * (todavía no cargó, o es de otro origen y el navegador no deja acceder a sus reglas). */
function readLoadedCss(href: string): string | null {
  if (!href) return null;
  for (const sheet of Array.from(document.styleSheets)) {
    if (sheet.href !== href) continue;
    try {
      return Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n");
    } catch {
      return null;
    }
  }
  return null;
}

function waitForLink(link: HTMLLinkElement): Promise<void> {
  return new Promise((resolve) => {
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener("error", () => resolve(), { once: true });
  });
}

function withTimeout(p: Promise<unknown>, ms: number): Promise<void> {
  return Promise.race([p.then(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, ms))]);
}
