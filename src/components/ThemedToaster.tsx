import { Toaster } from "@/components/ui/sonner";
import { useTheme } from "@/lib/theme";

/**
 * Mounted only where toasts are used (contact form, sign-in, dashboard) so public
 * pages don't download the toast library.
 */
export function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster theme={theme} />;
}
