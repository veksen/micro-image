import type { UnpluginFactory } from "unplugin";
import { transformReact } from "./transform";

export { transformReact } from "./transform";

/**
 * Finds `<Image>` from `@micro-image/image` in JSX and points its `src` at the
 * core's `?micro` loader. It does nothing else: reading files, sharp and the
 * placeholder all live in `@micro-image/unplugin`, which has to be installed too.
 */
export const unpluginFactory: UnpluginFactory<undefined> = () => ({
  name: "@micro-image/plugin-react",
  // Before the JSX is compiled away, or there is no `<Image>` left to find.
  enforce: "pre",
  transform: {
    filter: { id: { include: /\.[jt]sx$/, exclude: /[\\/]node_modules[\\/]/ } },
    handler(code, id) {
      return transformReact(code, id);
    },
  },
});
