// src/components/ui/signin.tsx
import { useClerk, useUser } from "@clerk/react";
import { Loader2, LogIn, LogOut } from "lucide-react";
import { type VariantProps } from "class-variance-authority";
import { Button, buttonVariants } from "@/components/ui/button.tsx";

export interface SignInButtonProps
  extends Omit<React.ComponentProps<"button">, "onClick">,
    VariantProps<typeof buttonVariants> {
  showIcon?: boolean;
  signInText?: string;
  signOutText?: string;
}

export function SignInButton({
  showIcon = true,
  signInText = "Sign In",
  signOutText = "Sign Out",
  className,
  variant,
  size,
  ...props
}: SignInButtonProps) {
  const { openSignIn, signOut } = useClerk();
  const { isSignedIn, isLoaded } = useUser();

  const icon = !isLoaded ? (
    <Loader2 className="size-4 animate-spin" />
  ) : isSignedIn ? (
    <LogOut className="size-4" />
  ) : (
    <LogIn className="size-4" />
  );

  return (
    <Button
      onClick={() => (isSignedIn ? signOut() : openSignIn())}
      disabled={!isLoaded}
      variant={variant}
      size={size}
      className={className}
      aria-label={isSignedIn ? "Sign out of your account" : "Sign in to your account"}
      {...props}
    >
      {showIcon && icon}
      {!isLoaded ? "Loading..." : isSignedIn ? signOutText : signInText}
    </Button>
  );
}