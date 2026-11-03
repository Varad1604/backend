import { SetMetadata } from '@nestjs/common';
import type { Capability } from './policy';
export const Public = () => SetMetadata('kpmpl.public', true);
export const Requires = (capability: Capability) => SetMetadata('kpmpl.capability', capability);
export const RequiresAny = (...capabilities: Capability[]) => SetMetadata('kpmpl.capabilitiesAny', capabilities);
