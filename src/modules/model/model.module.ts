import { DynamicModule, Module, Provider } from '@nestjs/common';
import { SchemaFactory, getConnectionToken } from '@nestjs/mongoose';
import {
  ClientSession,
  Connection,
  Model,
  PipelineStage,
  Schema,
  Types,
} from 'mongoose';
import { AbstractSchema } from '../../abstracts/AbstractSchema';
import {
  getMethodFactoryToken,
  getMethodToken,
  getModelFactoryToken,
  getModelToken,
} from '../../decorators';
import { TOKEN } from '../../enums';
import { getDbName } from '../../utils';
import { ConnectionModule } from '../connection';
import { ConnectionService } from '../connection/connection.service';
import { WorkerService } from '../worker';
import { generateExists, generateExistsAll } from './methods/check-exists';
import { generateCreate } from './methods/create';
import { generateCreateQueue } from './methods/create-queue';
import {
  generateFindByIdAndDelete,
  generateFindOneAndDelete,
} from './methods/delete-one';
import { generateCount, generateFind } from './methods/find';
import { generateFindById, generateFindOne } from './methods/find-one';
import { generateLookup } from './methods/helper';
import {
  generateFindByIdAndUpdate,
  generateFindOneAndUpdate,
} from './methods/update-one';
import {
  generateDeleteMany,
  generateInsertMany,
  generateUpdateMany,
} from './methods/upsert-many';

type Group = {
  asObject: {
    [k: string]: number;
  };
  asArray: {
    status: string;
    total: number;
  }[];
};

export type SchemaDefinition<D = any> = (new () => any) & {
  collectionName: string;
  hook?: (schema: Schema<D>, tenant?: string) => void;
  master?: boolean;
  partialSearch?: string[];
};

const methodFactory = function <D extends AbstractSchema>(
  Model: Model<D> & ModelStatics,
  name: string,
  tenant?: string,
) {
  name ??= Model.collection.name;

  const createQueue = generateCreateQueue(Model, name, tenant);

  const find = generateFind(Model);

  const count = generateCount(Model);

  const findOne = generateFindOne(Model, name);

  const findById = generateFindById(Model, name);

  const findOneAndUpdate = generateFindOneAndUpdate(Model, name, tenant);

  const findByIdAndUpdate = generateFindByIdAndUpdate(Model, name, tenant);

  const findOneAndDelete = generateFindOneAndDelete(Model, name);

  const findByIdAndDelete = generateFindByIdAndDelete(Model, name);

  const exists = generateExists(Model, name);

  const existsAll = generateExistsAll(Model, name);

  const create = generateCreate(Model, name, tenant);

  const insertMany = generateInsertMany(Model, name, tenant);
  const updateMany = generateUpdateMany(Model);
  const deleteMany = generateDeleteMany(Model);

  async function groupBy(
    field: string,
    keys: string[],
    pipeline: PipelineStage[] = [],
  ) {
    const rawData = await Model.aggregate([
      ...pipeline,
      {
        $group: {
          _id: `$${field}`,
          total: { $count: {} },
        },
      },
    ]);
    const data: Group = {
      asObject: {},
      asArray: [],
    };
    rawData.forEach(({ _id, total }) => {
      data.asObject[_id] = total;
      data.asArray.push({
        status: _id,
        total,
      });
    });
    keys.forEach((status) => {
      if (!data.asObject[status]) {
        data.asObject[status] = 0;
        data.asArray.push({
          status,
          total: 0,
        });
      }
    });
    return data;
  }

  async function aggregatePagination<T = any[]>(
    pipelinesPagination: (FacetPipelineStage | 'PAGINATION')[],
    queryParam: QueryParams | undefined = undefined,
  ): Promise<{ data: T; total: number }> {
    const {
      skip = 0,
      limit = Number.MAX_SAFE_INTEGER,
      sort = { createdAt: -1 },
    } = queryParam || {};

    const pipelineData: FacetPipelineStage[] = [];
    const pipelinePagination: FacetPipelineStage[] = [];
    let isFoundPagination = false;
    pipelinesPagination.forEach((o) => {
      if (o !== 'PAGINATION') {
        pipelineData.push(o);
        if (isFoundPagination) {
          pipelinePagination.push(o);
        }
      } else {
        isFoundPagination = true;
        pipelinePagination.push(
          {
            $sort: sort,
          },
          {
            $skip: skip,
          },
          {
            $limit: limit,
          },
        );
      }
    });

    if (!isFoundPagination) {
      pipelinePagination.push(
        {
          $sort: sort,
        },
        {
          $skip: skip,
        },
        {
          $limit: limit,
        },
      );
    }

    const [result] = await Model.aggregate([
      ...pipelineData,
      {
        $facet: {
          data: pipelinePagination,
          total: [
            {
              $group: {
                _id: null,
                total: { $count: {} },
              },
            },
          ],
        },
      },
    ]);
    const { data, total } = result || {};
    return {
      data: data || [],
      total: total?.[0]?.total || 0,
    };
  }

  async function aggregate(pipeline: PipelineStage[]) {
    return await Model.aggregate(pipeline);
  }

  async function transaction<T = any>(
    callback: (session: ClientSession) => Promise<T>,
  ) {
    const session = await Model.startSession();
    try {
      session.startTransaction();
      const result = await callback(session);
      await session.commitTransaction();
      return result;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  }

  function createInstance(doc: Partial<D> | undefined) {
    return new Model(doc);
  }

  return {
    model: Model,
    generateLookup,
    find,
    findOne,
    findById,
    findOneAndUpdate,
    findOneAndDelete,
    findByIdAndUpdate,
    findByIdAndDelete,
    groupBy,
    exists,
    existsAll,
    createQueue,
    transaction,
    create,
    insertMany,
    updateMany,
    deleteMany,
    createInstance,
    aggregatePagination,
    aggregate,
    count,
  };
};

export type Method<D extends AbstractSchema> = ReturnType<
  typeof methodFactory<D>
>;

export type ModelFactory<D extends AbstractSchema> = (
  tenant?: string,
) => Model<D>;
export type MethodFactory<D extends AbstractSchema> = (
  tenant?: string,
) => Method<D>;

@Module({})
export class ModelModule {
  private static registerInput: {
    [k: string]: SchemaDefinition;
  } = {};

  private static registerSchema<D extends AbstractSchema>(
    Decorator: SchemaDefinition<D>,
  ) {
    const Schema = SchemaFactory.createForClass(Decorator) as Schema<
      any,
      any,
      any,
      any,
      any,
      ModelStatics
    >;
    const isSoftDelete = Schema.statics.isSoftDelete?.();
    const isIncreasementId = Schema.statics.isIncreasementId?.();
    if (isSoftDelete) {
      Schema.add({ deletedAt: Date });
      if (isIncreasementId) {
        Schema.add({ cloneOf: Number });
      } else {
        Schema.add({ cloneOf: Types.ObjectId });
      }
    }

    if (Decorator.hook) {
      Decorator.hook(Schema);
    }

    if (isIncreasementId) {
      Schema.add({ _id: Number });
    }
    return Schema;
  }

  private static registerWithTenant(
    input: SchemaDefinition,
    tenant: string | undefined = undefined,
    connection: Connection,
    connectionService: ConnectionService,
  ) {
    const Schema = this.registerSchema(input);
    const name = this.getName(input);
    this.createModelFactory(name, Schema)(
      connection,
      connectionService,
      tenant,
    );
  }

  static init(
    connection: Connection,
    connectionService: ConnectionService,
    workerService: WorkerService,
  ) {
    Object.values(this.registerInput).forEach((input) => {
      if (input.master) {
        ModelModule.registerWithTenant(
          input,
          undefined,
          connection,
          connectionService,
        );
        workerService.register('master', input.collectionName || input.name);
      } else {
        global.tenants.forEach((id) => {
          ModelModule.registerWithTenant(
            input,
            id,
            connection,
            connectionService,
          );
          workerService.register(id, input.collectionName || input.name);
        });
      }
    });
  }

  static createModelFactory<D = any>(name: string, Schema: Schema<D>) {
    return function (
      connection: Connection,
      connectionService: ConnectionService,
      tenant: string | undefined = undefined,
    ) {
      const dbName = getDbName(tenant);
      const getConnection = connectionService.get(dbName);
      if (getConnection) {
        if (getConnection.models[name]) {
          return getConnection.models[name];
        }
        return getConnection.model(name, Schema);
      }

      const createConnection = connection.useDb(dbName);

      const setConnection = connectionService.set(dbName, createConnection);
      if (setConnection.models[name]) {
        return setConnection.models[name];
      }
      return setConnection.model(name, Schema);
    };
  }

  private static getName(
    Decorator: (new () => any) & { collectionName?: string },
  ) {
    return Decorator.collectionName || Decorator.name;
  }

  static register(registerInput: SchemaDefinition[]): DynamicModule {
    const providers: Provider[] = [];
    registerInput.forEach((input) => {
      const Schema = this.registerSchema(input);
      const name = this.getName(input);
      this.registerInput[name] = input;
      const injectModel = [getConnectionToken(), ConnectionService];
      const injectMethod = [getModelToken(name)];
      if (!input.master) {
        injectModel.push(TOKEN.TENANT);
        injectMethod.push(TOKEN.TENANT);
      }

      providers.push(
        {
          provide: getModelToken(name),
          useFactory: this.createModelFactory(name, Schema),
          inject: injectModel,
        },
        {
          provide: getMethodToken(name),
          useFactory: (Model: Model<any> & ModelStatics, tenant?: string) => {
            return methodFactory(Model, name, tenant);
          },
          inject: injectMethod,
        },
      );
    });
    return {
      imports: [ConnectionModule],
      module: ModelModule,
      providers: providers,
      exports: providers,
    };
  }

  static registerWithoutRequest(
    registerInput: SchemaDefinition[],
  ): DynamicModule {
    const providers: Provider[] = [];
    registerInput.forEach((input) => {
      const Schema = this.registerSchema(input);
      const name = this.getName(input);
      this.registerInput[name] = input;
      providers.push(
        {
          provide: getModelFactoryToken(name),
          useFactory: (
            connection: Connection,
            tenantService: ConnectionService,
          ) => {
            return (tenant?: string) => {
              return this.createModelFactory(name, Schema)(
                connection,
                tenantService,
                tenant,
              );
            };
          },
          inject: [getConnectionToken(), ConnectionService],
        },
        {
          provide: getMethodFactoryToken(name),
          useFactory: (
            modelFactory: (tenant?: string) => Model<any> & ModelStatics,
          ) => {
            return function (tenant?: string) {
              const model = modelFactory(tenant);
              return methodFactory(model, name, tenant);
            };
          },
          inject: [getModelFactoryToken(name)],
        },
      );
    });

    return {
      module: ModelModule,
      imports: [ConnectionModule],
      providers: providers,
      exports: providers,
    };
  }
}
