import { TableClient } from "@azure/data-tables";
import { AzureFunction, Context } from "@azure/functions";

import * as TE from "fp-ts/lib/TaskEither";
import * as E from "fp-ts/lib/Either";
import * as RA from "fp-ts/lib/ReadonlyArray";
import { pipe } from "fp-ts/lib/function";

import * as t from "io-ts";

import { IntegerFromString } from "@pagopa/ts-commons/lib/numbers";

import * as AI from "../utils/AsyncIterableTask";
import run from "../CosmosApiServicesImportEvent/index";
import { CommandMessageReport } from "../CosmosApiServicesImportEvent/commands";

const TODO_STATUS = t.literal("TODO");
const ERROR_STATUS = t.literal("ERROR");
const DONE_STATUS = t.literal("DONE");
const PENDING_STATUS = t.literal("PENDING");

type AllStatus = t.TypeOf<typeof AllStatus>;
const AllStatus = t.union([
  TODO_STATUS,
  ERROR_STATUS,
  DONE_STATUS,
  PENDING_STATUS
]);

type Row = t.TypeOf<typeof Row>;
const Row = t.interface({
  partitionKey: t.string,
  rowKey: t.string,
  // eslint-disable-next-line sort-keys
  rangeMax: IntegerFromString,
  rangeMin: IntegerFromString,
  status: AllStatus
});

const logAndReturn = (context: Context) => (
  ...text: ReadonlyArray<unknown>
) => <A>(a: A): A => {
  context.log(...text);
  return a;
};

const startNewExport = (
  context: Context,
  table: TableClient,
  row: Row
): TE.TaskEither<Error, void> =>
  pipe(
    {
      operation: "process-message-report" as const,
      range_max: row.rangeMax,
      range_min: row.rangeMin
    },
    TE.of,
    TE.mapLeft(E.toError),
    TE.chainFirst(_ =>
      TE.tryCatch(
        () =>
          table.updateEntity({
            ...row,
            status: "PENDING"
          }),
        E.toError
      )
    ),
    TE.map(logAndReturn(context)("Start export..")),
    TE.map(CommandMessageReport.encode),
    TE.chain(c => TE.tryCatch(() => run(context, c), E.toError)),
    TE.map(_ => context.log("Export done...", _)),
    TE.mapLeft(_ => logAndReturn(context)("ERROR!!!...", _)(_)),
    TE.chainFirst(_ =>
      TE.tryCatch(
        () =>
          table.updateEntity({
            ...row,
            status: "DONE"
          }),
        E.toError
      )
    )
  );

export const timerTrigger: (
  exportCommandsStorage: TableClient
) => AzureFunction = exportCommandsStorage => async (
  context: Context
): Promise<void> =>
  pipe(
    exportCommandsStorage.listEntities({
      queryOptions: {
        filter: `status ne '${DONE_STATUS.value}' and status ne '${ERROR_STATUS.value}'`
      }
    }),
    AI.fromAsyncIterable,
    AI.foldTaskEither(E.toError),
    TE.map(RA.map(Row.decode)),
    TE.map(RA.rights),
    TE.chain(records =>
      records.length === 0 ||
      records.find(r => r.status === "PENDING") !== undefined
        ? TE.of<Error, void>(
            context.log("Another process pending, do nothing..")
          )
        : startNewExport(context, exportCommandsStorage, records[0])
    ),
    TE.mapLeft(_ => context.log("An error occurred: ", _)),
    TE.map(_ => context.log(_)),
    TE.toUnion
  )();
