import { runLiveAppEffectSync } from "@/effect/appRuntimeLive";
import {
  addSentryBreadcrumb,
  captureSentryException,
  type SentryBreadcrumb,
  initSentryService,
} from "@/effect/sentryService";
import { routingInstrumentation } from "@/effect/sentryServiceLive";

export { routingInstrumentation };

export function initSentry() {
  runLiveAppEffectSync(initSentryService());
}

export function addBreadcrumb(breadcrumb: SentryBreadcrumb) {
  runLiveAppEffectSync(addSentryBreadcrumb(breadcrumb));
}

export function captureException(cause: unknown) {
  runLiveAppEffectSync(captureSentryException(cause));
}
