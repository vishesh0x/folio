import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useState,
  type ReactNode,
} from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isPrivacyMode, type PrivacyMode } from "@/lib/constants";

const PRIVACY_HELP: Record<PrivacyMode, string> = {
  reveal:
    "Not in the page source. Visitors click “Show” to see it; bots that only read HTML never get it. Rate-limited, and checked with Turnstile when configured.",
  public: "Shown as plain text. Easiest to read, but scrapers can harvest it.",
  hidden: "Not shown anywhere on the site. People can still use the contact form.",
};

/** Who can see an email / phone number on the public site. */
export function PrivacySelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: PrivacyMode) => void;
}) {
  const id = useId();
  const mode: PrivacyMode = isPrivacyMode(value) ? value : "reveal";
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={mode} onValueChange={(v) => isPrivacyMode(v) && onChange(v)}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="reveal">Click to reveal (recommended)</SelectItem>
          <SelectItem value="public">Visible to everyone</SelectItem>
          <SelectItem value="hidden">Hidden</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{PRIVACY_HELP[mode]}</p>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-3xl md:text-4xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Label + control. Injects a generated `id` into the child so the label is truly associated. */
export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const only = Children.count(children) === 1 ? Children.only(children) : null;
  const control =
    isValidElement<{ id?: string }>(only) && !only.props.id ? cloneElement(only, { id }) : children;
  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {control}
    </div>
  );
}

export function Panel({
  title,
  children,
  actions,
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 md:p-6">
      {(title || actions) && (
        <div className="mb-5 flex items-center justify-between gap-3">
          {title && <h2 className="font-display text-xl">{title}</h2>}
          {actions}
        </div>
      )}
      <div className="space-y-4">{children}</div>
    </section>
  );
}

/** Comma-separated text input bound to a string array. */
export function TagInput({
  value,
  onChange,
  placeholder,
  id,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  id?: string;
}) {
  const [text, setText] = useState(value.join(", "));
  useEffect(() => {
    if (
      text
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .join(",") !== value.join(",")
    )
      setText(value.join(", "));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Input
      id={id}
      value={text}
      placeholder={placeholder ?? "comma, separated, values"}
      onChange={(e) => {
        setText(e.target.value);
        onChange(
          e.target.value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        );
      }}
    />
  );
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement>;
export function PrimaryButton({ children, className = "", type = "button", ...props }: BtnProps) {
  return (
    <button type={type} {...props} className={`btn-primary ${className}`}>
      {children}
    </button>
  );
}
export function GhostButton({ children, className = "", type = "button", ...props }: BtnProps) {
  return (
    <button type={type} {...props} className={`btn-ghost ${className}`}>
      {children}
    </button>
  );
}
/** Icon-only button: `aria-label` is required. */
export function IconButton({
  children,
  className = "",
  type = "button",
  ...props
}: BtnProps & { "aria-label": string }) {
  return (
    <button
      type={type}
      title={props["aria-label"]}
      {...props}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30 ${className}`}
    >
      {children}
    </button>
  );
}

export function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Warn before leaving a form with unsaved edits. */
export function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
}

/** Native-feeling confirm dialog replacement (accessible, styled). */
export { ConfirmButton } from "./ConfirmButton";
