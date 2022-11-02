import { constVoid, flow, identity, pipe } from "fp-ts/lib/function";
import * as T from "fp-ts/Task";
import * as TT from "fp-ts/TaskThese";
import * as RA from "fp-ts/ReadonlyArray";
import * as O from "fp-ts/Option";
import * as S from "fp-ts/string";
import { readableReport } from "@pagopa/ts-commons/lib/reporters";
import { not } from "fp-ts/lib/Predicate";
import * as t from "io-ts";
import {
  isFailure,
  isSuccess,
  OutboundPublisher
} from "../outbound/port/outbound-publisher";
import { OutboundTracker } from "../outbound/port/outbound-tracker";
import { InboundDocumentsProcessor } from "../inbound/port/inbound-documents-processor";
import { OutboundEnricher } from "../outbound/port/outbound-enricher";
import { OutboundFilterer } from "../outbound/port/outboud-filterer";
import * as DOF from "../outbound/adapter/dummy-outbound-filterer";

export const getAnalyticsProcessorForDocuments = <I>(
  decoder: t.Decoder<unknown, I>,
  tracker: OutboundTracker,
  contentEnricher: OutboundEnricher<I>,
  mainPublisher: OutboundPublisher<I>,
  fallbackPublisher: OutboundPublisher<I>,
  dataFilterer: OutboundFilterer<I> = DOF.create()
  // eslint-disable-next-line max-params
): InboundDocumentsProcessor => ({
  process: flow(
    RA.map(decoder.decode),
    documentsOrErrors =>
      TT.both(RA.lefts(documentsOrErrors), RA.rights(documentsOrErrors)),
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
    TT.map(
      flow(
        dataFilterer.filterArray,
        // Enrich and publish documents with the main publisher, then return the errors
        contentEnricher.enrichs,
        T.chain(enrichResults =>
          pipe(
            enrichResults,
            RA.filter(isSuccess),
            RA.map(success => success.document),
            mainPublisher.publishes,
            T.map(RA.concat(enrichResults)),
            T.map(RA.filter(isFailure))
          )
        ),
        // Publish documents in error with the fallback publisher: if the fallback fails, throw an error
        T.chain(
          flow(
            RA.map(failed => failed.document),
            fallbackPublisher.publishes,
            T.map(RA.filter(isFailure)),
            T.map(
              RA.reduce(
                "",
                (message, failure) => `${message}|${failure.error.message}`
              )
            ),
            T.map(
              flow(
                O.fromPredicate(not(S.isEmpty)),
                O.map(errorMessage => {
                  throw new Error(errorMessage);
                }),
                constVoid
              )
            )
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
