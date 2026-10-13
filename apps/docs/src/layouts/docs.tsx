import { useRouter } from "next/router";
import React from "react";
import cx from "classnames";

function Link({ href, children }: React.PropsWithChildren<{ href: string }>) {
  const { asPath } = useRouter();
  // Both paths are root-relative, so any base resolves them; pathname drops query and hash.
  const isActive = new URL(href, "http://n").pathname === new URL(asPath, "http://n").pathname;

  return (
    <a
      className={cx(
        "hover:underline text-mauve-11 dark:text-mauvedark-11 hover:text-mauve-12 dark:hover:text-mauvedark-12",
        { "font-bold": isActive }
      )}
      href={href}
    >
      {children}
    </a>
  );
}

export default function Layout({ children }: React.PropsWithChildren) {
  return (
    <div className="flex">
      <aside className="flex flex-col gap-2 w-[200px] p-4 bg-mauve-3 dark:bg-mauvedark-3">
        <Link href="/">Showcase</Link>
        <Link href="/install">Installation</Link>
        <Link href="/usage">Usage</Link>
        <Link href="/roadmap">Roadmap</Link>
        <Link href="/motivation">Motivation</Link>
      </aside>
      <main className="flex flex-col grow shrink items-center max-w-[800px] p-4 mx-auto">
        <div className="flex flex-col items-stretch gap-8 w-[100%]">{children}</div>
      </main>
    </div>
  );
}
