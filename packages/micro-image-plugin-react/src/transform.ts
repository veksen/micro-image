import { parse } from "@babel/parser";
import traverse, { type NodePath } from "@babel/traverse";
import MagicString from "magic-string";

/** The package whose default export is the component this adapter rewrites. */
const imageModule = "@micro-image/image";

/** Raster formats sharp reads and the proxy serves. SVG has no pixels to size. */
const rasterSource = /\.(?:avif|gif|jpe?g|png|tiff?|webp)$/i;

export interface TransformResult {
  code: string;
  map: ReturnType<MagicString["generateMap"]>;
}

/**
 * Rewrites `<Image src="./hero.jpg" />` into `<Image _micro={meta} />` with
 * `import meta from "./hero.jpg?micro"` hoisted, where `Image` provably is the
 * default export of `@micro-image/image`. Returns null when nothing was
 * rewritten. The component merges any written prop over `_micro` (ADR 0006).
 *
 * Precision over recall: every check below that fails leaves the element as
 * written. The component still renders it; the only loss is the build-time
 * metadata.
 */
export function transformReact(code: string, id: string): TransformResult | null {
  // Cheap gate: a file that never names the package cannot import from it.
  if (!code.includes(imageModule)) return null;

  const ast = parse(code, {
    sourceType: "module",
    plugins: id.endsWith(".tsx") ? ["jsx", "typescript"] : ["jsx"],
  });

  const output = new MagicString(code);
  const importsBySource = new Map<string, string>();

  traverse(ast, {
    JSXOpeningElement(path) {
      const name = path.node.name;
      if (name.type !== "JSXIdentifier") return;
      if (!isImageBinding(path, name.name)) return;

      const attributes = path.node.attributes;
      // A spread can carry its own `src` or `_micro`, and the component would
      // take it over the build's. What it holds is only known at runtime.
      if (attributes.some((attribute) => attribute.type === "JSXSpreadAttribute")) return;

      const named = (name: string) =>
        attributes.filter(
          (attribute) => attribute.type === "JSXAttribute" && attribute.name.name === name
        );
      // Someone already passed metadata by hand.
      if (named("_micro").length > 0) return;
      const srcAttributes = named("src");
      if (srcAttributes.length !== 1) return;
      const srcAttribute = srcAttributes[0];
      if (srcAttribute.type !== "JSXAttribute") return;

      const value = srcAttribute.value;
      if (value?.type !== "StringLiteral") return;
      const source = value.value;
      if (!source.startsWith("./") && !source.startsWith("../")) return;
      if (!rasterSource.test(source)) return;

      let local = importsBySource.get(source);
      if (!local) {
        local = path.scope.getProgramParent().generateUid("micro");
        importsBySource.set(source, local);
      }

      // `src` goes, because a written `src` would win over `_micro.src`. The
      // relative path is the file on disk, not a URL the proxy can fetch.
      output.remove(whitespaceBefore(code, srcAttribute.start!), srcAttribute.end!);
      // After any type arguments, which sit between the name and the props.
      const afterName = path.node.typeArguments?.end ?? name.end!;
      output.appendLeft(afterName, ` _micro={${local}}`);
    },
  });

  if (importsBySource.size === 0) return null;

  const imports = [...importsBySource]
    .map(([source, local]) => `import ${local} from ${JSON.stringify(`${source}?micro`)};\n`)
    .join("");
  // After any directive such as "use client", which has to stay first.
  const directives = ast.program.directives;
  const insertAt = directives.length > 0 ? directives[directives.length - 1].end! : 0;
  if (insertAt === 0) output.prepend(imports);
  else output.appendRight(insertAt, `\n${imports}`);

  return { code: output.toString(), map: output.generateMap({ source: id, hires: true }) };
}

/**
 * True when `name` at this element resolves, through the parser's own scope
 * analysis, to the default import of `@micro-image/image` and is never
 * reassigned. A local shadow, a re-export through a barrel, or a wrapper all
 * fail this, by design.
 */
function isImageBinding(path: NodePath, name: string): boolean {
  const binding = path.scope.getBinding(name);
  if (!binding || binding.kind !== "module" || !binding.constant) return false;

  const specifier = binding.path;
  const isDefault =
    specifier.isImportDefaultSpecifier() ||
    (specifier.isImportSpecifier() &&
      specifier.node.imported.type === "Identifier" &&
      specifier.node.imported.name === "default");
  if (!isDefault) return false;

  const declaration = specifier.parentPath;
  return (
    declaration?.isImportDeclaration() === true && declaration.node.source.value === imageModule
  );
}

/** Start of the whitespace that separates an attribute from what precedes it. */
function whitespaceBefore(code: string, index: number): number {
  let start = index;
  while (start > 0 && /\s/.test(code[start - 1])) start--;
  return start;
}
