import React from "react";

export default function Layout({ children }: React.PropsWithChildren) {
  return (
    <div className="flex">
      <aside className="w-[200px] p-4 bg-mauve-3 dark:bg-mauvedark-3">abc</aside>
      <main className="flex flex-col grow items-center">{children}</main>
    </div>
  );
}
