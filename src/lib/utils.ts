import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The §2.1 type scale ships as custom Tailwind `fontSize` tokens (tailwind.config.ts).
// Plain twMerge doesn't know them, so `cn("text-sm", "text-control")` failed to drop
// `text-sm` and even misclassified `text-control` as a color — a stock shadcn variant's
// built-in `text-sm` would silently win over an on-scale override. Registering the token
// names in the `font-size` group makes the named sizes authoritative (so a diff never
// needs an arbitrary `text-[…]`).
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        { text: ["micro", "caption", "dense", "control", "body", "title", "section", "page", "display"] },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
