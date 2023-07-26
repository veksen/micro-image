import Image from "@micro-image/image";
import { useIsomorphicLayoutEffect } from "@micro-image/utils";

export default function Docs() {
  useIsomorphicLayoutEffect(() => {
    console.log("micro-image docs page");
  }, []);
  return (
    <div>
      <h1>micro-image Documentation</h1>
      <Image
        src="https://picsum.photos/id/237/800/500"
        width={800}
        height={500}
        alt=""
      />
    </div>
  );
}
