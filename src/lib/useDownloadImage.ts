import { useRef, useState } from "react";
import { toPng } from "html-to-image";

/** Captura el contenido de `ref` como PNG y lo descarga. Reutilizado por cualquier vista "para compartir". */
export function useDownloadImage(fileName: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  async function download() {
    const node = ref.current;
    if (!node) return;
    setDownloading(true);
    try {
      // Si alguna <img> (ej. el logo) todavía no terminó de cargar, el alto que mide
      // html-to-image queda corto y se exporta solo la parte de arriba — hay que esperarlas.
      const imgs = Array.from(node.querySelectorAll("img"));
      await Promise.all(
        imgs.map((img) => (img.complete ? Promise.resolve() : new Promise((res) => { img.onload = res; img.onerror = res; }))),
      );
      const dataUrl = await toPng(node, {
        backgroundColor: "#ffffff",
        pixelRatio: 2,
        width: node.scrollWidth,
        height: node.scrollHeight,
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${fileName}.png`;
      a.click();
    } finally {
      setDownloading(false);
    }
  }

  return { ref, download, downloading };
}
