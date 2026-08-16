// test_zod_descriptions.js — Test Zod schema conversion with field descriptions, enums, unions
import { tool } from '../src/tools.js';

async function executeWeather(args) {
  return 'sunny';
}

function testZodConversion() {
  console.log('--- Test: Zod Schema Conversion with Descriptions & Enums ---');

  // Mock Zod schema structure (matching Zod's internal _def)
  var mockZodSchema = {
    shape: {
      city: {
        _def: {
          typeName: 'ZodString',
          description: 'Target city name e.g. Tokyo'
        }
      },
      units: {
        _def: {
          typeName: 'ZodEnum',
          values: ['celsius', 'fahrenheit'],
          description: 'Temperature units'
        }
      }
    }
  };

  var weatherTool = tool({
    name: 'get_weather',
    description: 'Get weather for city',
    parameters: mockZodSchema,
    execute: executeWeather
  });

  var params = weatherTool.parameters;
  console.log('  Converted JSON Schema:', JSON.stringify(params, null, 2));

  var cityDesc = params.properties.city ? params.properties.city.description : undefined;
  var enumVals = params.properties.units ? params.properties.units.enum : undefined;

  if (cityDesc === 'Target city name e.g. Tokyo') {
    console.log('  ✅ PASS: Zod field description preserved');
  } else {
    console.error('  ❌ FAIL: Zod description missing');
    process.exit(1);
  }

  if (Array.isArray(enumVals) && enumVals.indexOf('celsius') >= 0) {
    console.log('  ✅ PASS: Zod enum values preserved');
  } else {
    console.error('  ❌ FAIL: Zod enum values missing');
    process.exit(1);
  }

  console.log('✅ Zod schema conversion tests passed successfully!\n');
}

testZodConversion();
