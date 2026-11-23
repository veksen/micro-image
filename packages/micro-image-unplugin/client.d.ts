// Reference with `/// <reference types="@micro-image/unplugin/client" />`.
// The shape is the component's own, so a `?micro` import passes straight to `_micro`.
declare module "*?micro" {
  const image: import("@micro-image/image").MicroImage;
  export default image;
}
