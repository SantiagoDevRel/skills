import {createRequire} from 'node:module';
import path from 'node:path';
import {repositoryRoot} from './build-plugin.mjs';

export function supportedSdkVersion(version, range, {root=repositoryRoot}={}) {
  // Resolve the declared verification dependency, independently of global npm.
  const require=createRequire(path.join(root,'tests/snippets/package.json'));
  const semver=require('semver');
  if(typeof version!=='string'||!semver.valid(version)) throw new Error('Published SDK version is not valid SemVer');
  if(typeof range!=='string'||!semver.validRange(range)) throw new Error('Configured SDK range is not valid SemVer');
  return semver.satisfies(version,range,{includePrerelease:false});
}
