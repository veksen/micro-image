import { describe, expect, it } from "vitest";
import { transformReact } from "./transform";

const run = (code: string, id = "/app/page.tsx") => transformReact(code, id)?.code ?? null;

describe("rewrites", () => {
  it("hoists a ?micro import and passes it as _micro in place of src", () => {
    expect(
      run(`import Image from "@micro-image/image";
export const Hero = () => <Image src="./hero.jpg" alt="Hero" />;`)
    ).toBe(`import _micro from "./hero.jpg?micro";
import Image from "@micro-image/image";
export const Hero = () => <Image _micro={_micro} alt="Hero" />;`);
  });

  it("keeps a hand-written width, which the component merges over _micro", () => {
    expect(
      run(`import Image from "@micro-image/image";
<Image width={800} src="./hero.jpg" objectFit="cover" />;`)
    ).toContain(`<Image _micro={_micro} width={800} objectFit="cover" />`);
  });

  it("puts _micro after explicit type arguments", () => {
    expect(
      run(`import Image from "@micro-image/image";
<Image<Opts> src="./hero.jpg" />;`)
    ).toContain(`<Image<Opts> _micro={_micro} />`);
  });

  it("follows a rename, because the binding is checked and not the name", () => {
    expect(
      run(`import Picture from "@micro-image/image";
<Picture src="../assets/a.png" />;`)
    ).toContain(`<Picture _micro={_micro} />`);
  });

  it("accepts the named form of the default import", () => {
    expect(
      run(`import { default as Image } from "@micro-image/image";
<Image src="./a.webp" />;`)
    ).toContain(`<Image _micro={_micro} />`);
  });

  it("imports each source once, however often it is used", () => {
    const out = run(`import Image from "@micro-image/image";
<><Image src="./a.jpg" /><Image src="./a.jpg" /><Image src="./b.jpg" /></>;`);
    expect(out?.match(/\?micro/g)).toHaveLength(2);
    expect(out).toContain(
      `<Image _micro={_micro} /><Image _micro={_micro} /><Image _micro={_micro2} />`
    );
  });

  it("does not collide with a local name the file already uses", () => {
    const out = run(`import Image from "@micro-image/image";
const _micro = 1;
<Image src="./a.jpg" />;`);
    expect(out).toContain(`import _micro2 from "./a.jpg?micro";`);
  });

  it("keeps a directive first", () => {
    expect(
      run(`"use client";
import Image from "@micro-image/image";
<Image src="./a.jpg" />;`)
    ).toMatch(/^"use client";\nimport _micro from "\.\/a\.jpg\?micro";\n/);
  });

  it("parses plain JSX in a .jsx file", () => {
    expect(
      run(
        `import Image from "@micro-image/image";
<Image src="./a.jpg" />;`,
        "/app/page.jsx"
      )
    ).toContain(`<Image _micro={_micro} />`);
  });
});

describe("leaves alone what it cannot prove", () => {
  it.each([
    ["another package's Image", `import Image from "next/image"; <Image src="./a.jpg" />;`],
    [
      "a named export that is not the default",
      `import { Image } from "@micro-image/image"; <Image src="./a.jpg" />;`,
    ],
    [
      "a local component shadowing the import",
      `import Image from "@micro-image/image";
function F() { const Image = (p) => null; return <Image src="./a.jpg" />; }`,
    ],
    [
      "a reassigned binding",
      `import * as M from "@micro-image/image"; let Image = M.default; Image = null; <Image src="./a.jpg" />;`,
    ],
    [
      "a member expression",
      `import * as M from "@micro-image/image"; <M.default src="./a.jpg" />;`,
    ],
    [
      "a remote URL",
      `import Image from "@micro-image/image"; <Image src="https://x.com/a.jpg" />;`,
    ],
    ["a root-relative path", `import Image from "@micro-image/image"; <Image src="/a.jpg" />;`],
    ["an expression src", `import Image from "@micro-image/image"; <Image src={url} />;`],
    [
      "a template-literal src",
      'import Image from "@micro-image/image"; <Image src={`./a.jpg`} />;',
    ],
    ["an SVG", `import Image from "@micro-image/image"; <Image src="./logo.svg" />;`],
    [
      "an element with a spread",
      `import Image from "@micro-image/image"; <Image src="./a.jpg" {...rest} />;`,
    ],
    [
      "an element that already has _micro",
      `import Image from "@micro-image/image"; <Image _micro={hero} src="./a.jpg" />;`,
    ],
    ["a lowercase img", `import Image from "@micro-image/image"; <img src="./a.jpg" />;`],
  ])("%s", (_, code) => {
    expect(run(code)).toBeNull();
  });

  it("rewrites the provable element and skips its unprovable sibling", () => {
    const out = run(`import Image from "@micro-image/image";
<><Image src="./a.jpg" /><Image src={dynamic} /></>;`);
    expect(out).toContain(`<Image _micro={_micro} /><Image src={dynamic} />`);
  });
});

it("returns a source map for the rewrite", () => {
  const result = transformReact(
    `import Image from "@micro-image/image";\n<Image src="./a.jpg" />;`,
    "/app/page.tsx"
  );
  expect(result?.map.mappings).toBeTruthy();
  expect(result?.map.sources).toEqual(["/app/page.tsx"]);
});
