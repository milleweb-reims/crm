import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        gray: "bg-gray-100 text-gray-700",
        blue: "bg-blue-100 text-blue-700",
        orange: "bg-orange-100 text-orange-700",
        violet: "bg-violet-100 text-violet-700",
        green: "bg-green-100 text-green-700",
        emerald: "bg-emerald-100 text-emerald-700",
        red: "bg-red-100 text-red-700",
      },
    },
    defaultVariants: {
      variant: "gray",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
