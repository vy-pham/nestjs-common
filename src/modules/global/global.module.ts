/** @format */

import {
  DynamicModule,
  ForwardReference,
  Global,
  Inject,
  InjectionToken,
  Module,
  OptionalFactoryDependency,
  Provider,
  Type,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, REQUEST } from '@nestjs/core';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { TOKEN } from '../../enums';
import { AppGuard } from '../../middlewares';
import { AllExceptionsFilter, TransformResponse } from '../../utils';
import { ConnectionModule } from '../connection/connection.module';
import { ConnectionService } from '../connection/connection.service';
import { ModelModule } from '../model';
import { WorkerService } from '../worker';
import { WorkerModule } from '../worker/worker.module';

const provideUser = {
  provide: TOKEN.USER,
  inject: [REQUEST],
  useFactory(request: any) {
    return request?.user || request?.req?.user;
  },
};

const provideTenant = {
  provide: TOKEN.TENANT,
  inject: [REQUEST],
  useFactory(request: any) {
    return request?.tenant || request?.req?.tenant;
  },
};

const provideMiddleware = [
  {
    provide: APP_FILTER,
    useClass: AllExceptionsFilter,
  },
  {
    provide: APP_INTERCEPTOR,
    useClass: TransformResponse,
  },

  {
    provide: APP_GUARD,
    useClass: AppGuard,
  },
];

@Global()
@Module({
  imports: [WorkerModule, ConnectionModule],
  providers: [provideUser, provideTenant, ...provideMiddleware],
  exports: [provideUser, provideTenant, WorkerModule, ConnectionModule],
})
export class GlobalModule {
  private static init?: (...args: any[]) => any;
  static register(input?: {
    init?: (...args: any[]) => any;
    initInject?: Array<InjectionToken | OptionalFactoryDependency>;
    providers?: Provider[];
    imports?: Array<
      Type<any> | DynamicModule | Promise<DynamicModule> | ForwardReference
    >;
  }): DynamicModule {
    this.init = input?.init;

    const providers: Provider[] = input?.providers || [];

    providers.push({
      provide: 'INIT_INJECTION',
      useFactory: async (...args: any[]) => {
        return args;
      },
      inject: input?.initInject || [],
    });
    return {
      module: GlobalModule,
      imports: input?.imports || [],
      providers: providers,
      exports: providers,
    };
  }
  @InjectConnection() connection: Connection;
  @Inject() connectionService: ConnectionService;
  @Inject('INIT_INJECTION') initInjection: any[];
  @Inject() workerService: WorkerService;
  async onModuleInit() {
    if (GlobalModule.init) {
      await GlobalModule.init(...this.initInjection);
    }
    ModelModule.init(
      this.connection,
      this.connectionService,
      this.workerService,
    );
  }
}
