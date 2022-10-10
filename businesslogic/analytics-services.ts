import { constVoid, flow, identity, pipe } from "fp-ts/lib/function";
import * as TE from "fp-ts/TaskEither";
import * as T from "fp-ts/Task";
import * as TT from "fp-ts/TaskThese";
import * as TH from "fp-ts/These";
import * as RA from "fp-ts/ReadonlyArray";
import * as O from "fp-ts/Option";
import { readableReport } from "@pagopa/ts-commons/lib/reporters";
import { RetrievedService } from "@pagopa/io-functions-commons/dist/src/models/service";
import {
  isFailure,
  OutboundPublisher
} from "../outbound/port/outbound-publisher";
import { OutboundTracker } from "../outbound/port/outbound-tracker";
import { InboundDocumentsProcessor } from "../inbound/port/inbound-documents-processor";

export const getAnalyticsProcessorForService = (
  tracker: OutboundTracker,
  mainPublisher: OutboundPublisher<RetrievedService>,
  fallbackPublisher: OutboundPublisher<RetrievedService>
): InboundDocumentsProcessor => ({
  process: flow(
    RA.map(RetrievedService.decode),
    serviceOrErrors =>
      TT.both(RA.lefts(serviceOrErrors), RA.rights(serviceOrErrors)),
    TT.mapLeft(
      flow(
        RA.map(
          flow(
            readableReport,
            message => tracker.trackError(new Error(message)),
            T.of
          )
        ),
        T.sequenceArray,
        T.map(constVoid)
      )
    ),
    TT.map(services =>
      pipe(
        services,
        mainPublisher.publishes,
        T.chain(pubServicesAndError =>
          pipe(
            pubServicesAndError,
            RA.filter(isFailure),
            RA.map(failed => failed.document),
            fallbackPublisher.publishes,
            T.map(RA.filter(isFailure)),
            T.map(
              RA.reduce(
                "",
                (message, failure) => `${message}|${failure.error.message}`
              )
            ),
            T.map(m => {
              if (m.length > 0) {
                throw new Error(m);
              }
            })
          )
        )
      )
    ),
    TT.fold(identity, identity, (errorTasks, publishTasks) =>
      pipe(
        errorTasks,
        T.chain(() => publishTasks)
      )
    )
  )
});
