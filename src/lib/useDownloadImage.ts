import { useRef, useState } from "react";
import { toPng } from "html-to-image";

/** Captura el contenido de `ref` como PNG y lo descarga. Reutilizado por cualquier vista "para compartir". */
export function useDownloadImage(fileName: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  async function download() {
    if (!ref.current) return;
    setDownloading(true);
    try {
      const dataUrl = await toPng(ref.current, { backgroundColor: "#ffffff", pixelRatio: 2 });
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
