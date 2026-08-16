// test_multimodal_images.js — Test multimodal image support in promptBuilder
import { buildMessages } from '../src/promptBuilder.js';
import fs from 'fs';
import path from 'path';

function testMultimodal() {
  console.log('--- Testing Multimodal Image Handling in promptBuilder ---');

  var testImagePath = path.join(process.cwd(), 'test', 'sample_test_image.png');
  var dummyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  fs.writeFileSync(testImagePath, Buffer.from(dummyPngBase64, 'base64'));

  try {
    var messages = buildMessages('Describe this image', [], process.cwd(), {
      images: [testImagePath, 'https://example.com/logo.png']
    });

    console.log('  Built Messages:', JSON.stringify(messages, null, 2));

    var userMsg = messages[1];
    var isArrayContent = Array.isArray(userMsg.content);

    if (isArrayContent && userMsg.content.length === 3) {
      console.log('  ✅ PASS: Multimodal content array correctly built with 1 text + 2 image items');
    } else {
      console.error('  ❌ FAIL: User message content structure incorrect');
      process.exit(1);
    }

    var firstImage = userMsg.content[1];
    if (firstImage && firstImage.image_url && firstImage.image_url.url.startsWith('data:image/png;base64,')) {
      console.log('  ✅ PASS: Local image file path automatically converted to Base64 Data URI');
    } else {
      console.error('  ❌ FAIL: Local image path was not converted to Data URI');
      process.exit(1);
    }

    var runHistory = [{ role: 'user', content: { text: 'Describe this image', images: [testImagePath] } }];
    var loopMessages = buildMessages({ text: 'Describe this image', images: [testImagePath] }, runHistory, process.cwd(), {
      promptAlreadyInHistory: true
    });
    var userMessageCount = 0;
    for (var messageIndex = 0; messageIndex < loopMessages.length; messageIndex++) {
      if (loopMessages[messageIndex].role === 'user') {
        userMessageCount++;
      }
    }
    if (userMessageCount === 1 && Array.isArray(loopMessages[1].content)) {
      console.log('  ✅ PASS: Current multimodal prompt is represented once in an agent loop');
    } else {
      console.error('  ❌ FAIL: Multimodal prompt was duplicated or not formatted in loop history');
      process.exit(1);
    }
  } finally {
    if (fs.existsSync(testImagePath)) {
      fs.unlinkSync(testImagePath);
    }
  }

  console.log('✅ Multimodal image handling tests passed successfully!\n');
}

testMultimodal();
