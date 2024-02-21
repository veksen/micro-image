import React from "react";

export default function Usage() {
  return (
    <>
      <h1 className="text-2xl font-bold">Usage</h1>

      <iframe
        src="https://codesandbox.io/embed/9gtpkz?view=preview&module=%2Fsrc%2FApp.tsx"
        style={{
          width: "100%",
          height: "500px",
          border: 0,
          borderRadius: "4px",
          overflow: "hidden",
        }}
        title="@micro-image/image basic-usage"
        allow="accelerometer; ambient-light-sensor; camera; encrypted-media; geolocation; gyroscope; hid; microphone; midi; payment; usb; vr; xr-spatial-tracking"
        sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts"
      />
    </>
  );
}
