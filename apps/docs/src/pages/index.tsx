import { Button } from "@micro-image/core";
import { useIsomorphicLayoutEffect } from "@micro-image/utils";

export default function Docs() {
  useIsomorphicLayoutEffect(() => {
    console.log("micro-image docs page");
  }, []);
  return (
    <div>
      <h1>micro-image Documentation</h1>
      <Button>Click me</Button>
    </div>
  );
}
