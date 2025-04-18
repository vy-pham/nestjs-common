/** @format */

import { config } from 'dotenv';
import * as fs from 'fs';
import {
  Document,
  Expression,
  FilterQuery,
  FlattenMaps,
  PipelineStage,
  Require_id,
  Types,
} from 'mongoose';
import * as path from 'path';
config({
  path: fs.existsSync(path.join(process.cwd(), '.env'))
    ? path.join(process.cwd(), '.env')
    : path.join(process.cwd(), '.env.example'),
});
declare module 'express' {
  export interface Request {
    tenant: string;
    user: JWTPayload;
    isAuthorization: boolean;
    jwt: string;
  }
}

const envConfig = {
  JWT_SECRET: process.env.JWT_SECRET || '',
  HOST_URL: process.env.HOST_URL || '',
  PUBLIC_KEY: process.env.PUBLIC_KEY || '',
  MONGODB_NAME: process.env.MONGODB_NAME || '',
};

declare global {
  var GlobalConfig: {
    [k in keyof typeof envConfig]: string;
  };
  var tenants: string[];
  export interface JWTPayload {
    _id: Types.ObjectId;
    tenant: string;
  }
  interface NestedObjectSelect {
    [k: string]: number | NestedObjectSelect;
  }
  interface QueryParams {
    skip: number;
    limit: number;
    sort?: Record<string, 1 | -1 | Expression.Meta>;
  }
  type StringOrObjectId = string | Types.ObjectId;
  type MergePopulate<I, IP> = Omit<
    Document<
      unknown,
      {},
      I & {
        _id: DataId;
      }
    > &
      Omit<
        I & {
          _id: DataId;
          __v: number;
        } & Required<{
            _id: DataId;
          }>,
        never
      >,
    keyof IP
  > &
    IP;

  type DataId = string | Types.ObjectId;

  type FacetPipelineStage = Exclude<
    PipelineStage,
    | PipelineStage.CollStats
    | PipelineStage.Facet
    | PipelineStage.GeoNear
    | PipelineStage.IndexStats
    | PipelineStage.Out
    | PipelineStage.Merge
    | PipelineStage.PlanCacheStats
  >;

  type RecursiveKeyOf<TObj> = {
    [TKey in keyof TObj & (string | number)]: TObj[TKey] extends
      | any[]
      | Types.ObjectId
      ? `${TKey}`
      : TObj[TKey] extends Types.ObjectId | string
      ? `${TKey}` | `${TKey}.${RecursiveKeyOf<TObj[TKey]>}`
      : `${TKey}`;
  }[keyof TObj & (string | number)];

  type GeneratePipeline<T = any> = {
    from: string;
    localField: RecursiveKeyOf<T> | RecursiveKeyOf<T>[];
    foreignField?: string;
    as?: string;
    lookup?: GeneratePipeline[];
    unwind?: boolean;
    pipeline?: Exclude<
      PipelineStage,
      PipelineStage.Merge | PipelineStage.Out
    >[];
    postPipeline?: Exclude<
      PipelineStage,
      PipelineStage.Merge | PipelineStage.Out
    >[];
    match?: FilterQuery<any>;
    project?: NestedObjectSelect;
    keepNull?: boolean;
    let?: PipelineStage.Lookup['$lookup']['let'];
    sort?: Record<string, 1 | -1 | Expression.Meta>;
    skip?: number;
    limit?: number;
  };

  type GeneratePipelineWithOptions<T = any> = (
    query?: FilterQuery<any>,
    select?: NestedObjectSelect,
  ) => GeneratePipeline<T>;
  interface Pagination {
    page: undefined | number;
    limit: undefined | number;
  }

  type ModelStatics = {
    isSoftDelete: () => boolean;
    isIncreasementId: () => boolean;
    getPartialSearch?: () => string[];
  };

  type LeanDocument<D> = Require_id<FlattenMaps<D>>;
}
global.GlobalConfig = envConfig;
global.tenants = [];
