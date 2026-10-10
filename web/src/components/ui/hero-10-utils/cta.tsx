import { Button, type ButtonProps } from "@/components/ui/button"

export interface CtaProps {
  ctaEnabled: boolean
  text: string
  link: string
  variant?: ButtonProps["variant"]
  size?: ButtonProps["size"]
}

/** One call-to-action button; renders a link when `link` is set. */
export function Cta({ cta }: Readonly<{ cta: CtaProps }>) {
  if (!cta.link) {
    return <Button variant={cta.variant} size={cta.size}>{cta.text}</Button>
  }
  return (
    <Button asChild variant={cta.variant} size={cta.size} className="no-underline">
      <a href={cta.link}>{cta.text}</a>
    </Button>
  )
}
