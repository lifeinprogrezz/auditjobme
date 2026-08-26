/// <reference types="vite/client" />

// pdfmake ships its PDF standard-font containers (metrics only, no font file) without
// a type entry; @types/pdfmake covers the main build and vfs_fonts only.
declare module "pdfmake/build/standard-fonts/Helvetica" {
  import type { TFontContainer } from "pdfmake/interfaces";
  const helvetica: TFontContainer;
  export default helvetica;
}
