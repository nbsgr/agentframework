import assert from 'assert';
import { validateToolArguments } from '../src/tools.js';

function testToolArgumentValidation() {
  var schema = {
    type: 'object',
    properties: {
      path: { type: 'string' },
      count: { type: 'integer' },
      mode: { type: 'string', enum: ['read', 'write'] }
    },
    required: ['path', 'mode']
  };

  assert(validateToolArguments({ path: 'package.json', mode: 'read' }, schema).valid === true);
  assert(validateToolArguments({ path: 42, mode: 'read' }, schema).valid === false);
  assert(validateToolArguments({ path: 'package.json' }, schema).valid === false);
  assert(validateToolArguments({ path: 'package.json', mode: 'delete' }, schema).valid === false);
  assert(validateToolArguments({ path: 'package.json', mode: 'read', count: 2 }, schema).valid === true);
  console.log('Tool argument validation tests passed.');
}

testToolArgumentValidation();
