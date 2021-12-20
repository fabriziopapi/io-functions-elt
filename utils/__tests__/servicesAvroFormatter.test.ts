import * as avro from "avsc";
import { services } from "../../generated/avro/dto/services";

import { aRetrievedService } from "../../__mocks__/services.mock";
import {
  avroServiceFormatter,
  buildAvroServiceObject
} from "../formatter/servicesAvroFormatter";

describe("servicesAvroFormatter", () => {
  it("should serialize a valid service with isQuality = false", async () => {
    const exclusionList: string[] = [];

    const formatter = avroServiceFormatter(exclusionList);

    const avroFormattedValue = formatter(aRetrievedService);
    const dtoExpected = buildAvroServiceObject(
      aRetrievedService,
      exclusionList
    );

    const serviceSchema = avro.Type.forSchema(services.schema as avro.Schema);

    const decodedValue = serviceSchema.fromBuffer(
      avroFormattedValue.value as Buffer
    );

    expect(decodedValue).toEqual(dtoExpected);
    expect(decodedValue.isQuality).toEqual(false);
  });

  it("should serialize a valid service with isQuality = true (exclusion list)", async () => {
    const exclusionList = [aRetrievedService.serviceId];

    const formatter = avroServiceFormatter(exclusionList);

    const avroFormattedValue = formatter(aRetrievedService);
    const dtoExpected = buildAvroServiceObject(
      aRetrievedService,
      exclusionList
    );

    const serviceSchema = avro.Type.forSchema(services.schema as avro.Schema);

    const decodedValue = serviceSchema.fromBuffer(
      avroFormattedValue.value as Buffer
    );

    expect(decodedValue).toEqual(dtoExpected);
    expect(decodedValue.isQuality).toEqual(true);
  });
});
