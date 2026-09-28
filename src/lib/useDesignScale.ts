import { useLayoutEffect, useRef, useState } from "react";

/**
 * Para carteles diseñados con medidas fijas en px pensadas para un ancho exacto (ej. un
 * diseño calculado para 480px que la descarga después captura a 1080px físicos): el
 * contenido real vive siempre a `designWidth` de ancho -- así cualquier cálculo que lea su
 * `clientWidth` (la descarga, por ejemplo) da siempre el mismo número, sin importar el
 * dispositivo -- y se lo escala visualmente con un `transform` para que entre en el ancho
 * real disponible en pantalla, que en un celular angosto puede ser bastante menor.
 *
 * Sin esto, dejar que el contenido tuviera el ancho real de la pantalla (con medidas en px
 * pensadas para 480px) hacía que todo saliera más grande de lo debido en un celular más
 * angosto que 480px -- la escala de captura (1080 / ancho real) compensaba de más.
 */
export function useDesignScale(designWidth: number) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    function update() {
      if (!outer || !inner) return;
      const s = outer.clientWidth / designWidth;
      setScale(s);
      setHeight(inner.scrollHeight * s);
    }

    update();
    const ro = new ResizeObserver(update);
    ro.observe(outer);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [designWidth]);

  return { outerRef, innerRef, scale, height };
}
