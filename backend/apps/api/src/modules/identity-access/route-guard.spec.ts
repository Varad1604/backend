import 'reflect-metadata';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { ModulesContainer } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';

describe('route capability coverage', () => {
  it('requires every HTTP route to be public or capability-guarded', async () => {
    const testing = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const modules = testing.get(ModulesContainer);
    const uncovered: string[] = [];
    for (const module of modules.values()) for (const wrapper of module.controllers.values()) {
      const controller = wrapper.instance as object | undefined;
      if (!controller) continue;
      const prototype = Object.getPrototypeOf(controller) as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[name];
        if (typeof handler !== 'function' || Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
        const guarded = Reflect.getMetadata('kpmpl.public', handler) || Reflect.getMetadata('kpmpl.public', controller.constructor)
          || Reflect.getMetadata('kpmpl.capability', handler) || Reflect.getMetadata('kpmpl.capability', controller.constructor)
          || Reflect.getMetadata('kpmpl.capabilitiesAny', handler) || Reflect.getMetadata('kpmpl.capabilitiesAny', controller.constructor);
        if (!guarded) uncovered.push(controller.constructor.name + '.' + name);
      }
    }
    await testing.close();
    expect(uncovered).toEqual([]);
  });
});
