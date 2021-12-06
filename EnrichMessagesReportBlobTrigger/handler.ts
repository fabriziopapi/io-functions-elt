import { Context } from "@azure/functions";
import { BlobService } from "azure-storage";

import * as E from "fp-ts/Either";
import * as T from "fp-ts/lib/Task";
import * as TE from "fp-ts/TaskEither";
import { pipe } from "fp-ts/lib/function";

import {
  MessageReportArray,
  MessageReportExtended,
  VisibleServicesExtended
} from "../utils/types/reportTypes";
import {
  IBulkOperationResultEntity,
  toBulkOperationResultEntity
} from "../utils/bulkOperationResult";

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type ServiceData = {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly organizationName: string;
};

/**
 * Extract service info from visible-services-extended.json
 */
const toServiceMap = (
  services: VisibleServicesExtended
): ReadonlyMap<string, ServiceData> =>
  services.reduce((prev, curr) => {
    curr.s.forEach(s =>
      prev.set(s.i, {
        organizationName: curr.o,
        serviceId: s.i,
        serviceName: s.n
      })
    );
    return prev;
  }, new Map<string, ServiceData>());

/**
 * Export report to CSV
 */
const toCSV = (report: ReadonlyArray<MessageReportExtended>): string =>
  report.reduce((prev, curr) => {
    // eslint-disable-next-line no-param-reassign
    prev += `${curr.organizationName}\t${curr.serviceName}\t${curr.serviceId}\t${curr.sent}\t${curr.delivered}\t${curr.delivered_payment}\n`;
    return prev;
  }, "ORGANIZATION NAME\tSERVICE NAME\tSERVICE ID\tSENT\tDELIVERED\tDELIVERED (PAYMENT)\n");

/**
 * Enrich Message Report with services info
 */
export const handler = (
  exportToBlob: (
    blobName: string
  ) => (text: string) => TE.TaskEither<Error, BlobService.BlobResult>
) => async (
  context: Context,
  messageReportBlob: Buffer,
  visibleServicesExtended: ReadonlyArray<undefined>
): Promise<IBulkOperationResultEntity> =>
  pipe(
    visibleServicesExtended,
    VisibleServicesExtended.decode,
    TE.fromEither,
    TE.map(toServiceMap),
    TE.bindTo("services"),
    TE.bind("messageReport", _ =>
      pipe(
        messageReportBlob.toString(),
        JSON.parse,
        MessageReportArray.decode,
        TE.fromEither
      )
    ),
    TE.map(({ services, messageReport }) =>
      messageReport.map(m => ({
        ...m,
        organizationName: services.get(m.serviceId)?.organizationName ?? "-",
        serviceName: services.get(m.serviceId)?.serviceName ?? "-"
      }))
    ),
    TE.map(toCSV),
    TE.chainW(
      exportToBlob(
        ((context.bindingData.name as string) ?? "export.csv").replace(
          ".json",
          ".csv"
        )
      )
    ),
    T.map(_ => {
      context.log("RESULT SUCCESS: ", E.isRight(_));
      return _;
    }),
    TE.map(_ => ({ isSuccess: true, result: "none" })),
    TE.mapLeft(_ => ({ isSuccess: false, result: "none" })),
    TE.toUnion,
    T.map(toBulkOperationResultEntity("enrich-message-report"))
  )();
