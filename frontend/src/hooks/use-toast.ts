import { toast as sonnerToast } from "sonner"

type ToastProps = {
  title?: string
  description?: string
  variant?: "default" | "destructive" | "success"
}

export function useToast() {
  const toast = ({ title, description, variant }: ToastProps) => {
    const options = {
      description,
    }

    switch (variant) {
      case "success":
        sonnerToast.success(title, options)
        break
      case "destructive":
        sonnerToast.error(title, options)
        break
      default:
        sonnerToast(title, options)
        break
    }
  }

  return {
    toast,
  }
}
