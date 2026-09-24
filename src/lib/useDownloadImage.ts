import { useRef, useState } from "react";
import html2canvas from "html2canvas-pro";

const MAX_OUTPUT_HEIGHT = 4000; // límite de canvas seguro para navegadores de celular (sobre todo iOS)

/**
 * Captura el contenido de `ref` como PNG y lo descarga. Reutilizado por cualquier vista
 * "para compartir". Usa html2canvas (dibuja el DOM directo a un canvas) en vez de
 * html-to-image (que serializa a un SVG con foreignObject) — esta última tenía un bug real
 * con layouts flexbox anidados: la tarjeta quedaba con contenido solo en la mitad
 * izquierda y la derecha en blanco, algo invisible en pruebas simples pero muy notorio en
 * un cartel real con varias canchas y partidos.
 */
export function useDownloadImage(fileName: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  async function download() {
    const node = ref.current;
    if (!node) return;
    setDownloading(true);
    try {
      // Si alguna <img> (ej. el logo) todavía no terminó de cargar, el alto que se mide
      // queda corto y se exporta solo la parte de arriba — hay que esperarlas.
      const imgs = Array.from(node.querySelectorAll("img"));
      await Promise.all(
        imgs.map((img) => (img.complete ? Promise.resolve() : new Promise((res) => { img.onload = res; img.onerror = res; }))),
      );

      // Los navegadores de celular (sobre todo iOS) tienen un límite de tamaño de canvas
      // bastante más chico que en la compu — un cartel muy alto (un día con muchos
      // partidos) a escala fija 2x lo podía superar. Se limita la escala para que el
      // canvas final nunca pase de cierto alto, sea cual sea el dispositivo.
      const scale = Math.min(2, MAX_OUTPUT_HEIGHT / node.scrollHeight) || 1;

      const canvas = await html2canvas(node, {
        backgroundColor: "#ffffff",
        scale,
        useCORS: true,
      });
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
