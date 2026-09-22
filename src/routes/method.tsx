import { createFileRoute } from "@tanstack/react-router";
import { MethodPage } from "@/components/method/method-page";

export const Route = createFileRoute("/method")({ component: MethodPage });
