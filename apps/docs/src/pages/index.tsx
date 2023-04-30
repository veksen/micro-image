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
        src="https://picsum.photos/id/237/1300/1300"
        width={500}
        height={500}
      />
    </div>
  );
}
