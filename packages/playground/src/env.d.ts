/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  // Keep it strictly typed, no `any`:
  const component: DefineComponent<object, object, never>;
  export default component;
}
