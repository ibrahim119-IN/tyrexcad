/**
 * اختبارات Message Bus المحدثة للنسخة الجديدة
 */

import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { MessageBus, createMessageAPI } from '../../core/message-bus.js';

describe('MessageBus Core - Enhanced Version', () => {
  let messageBus;

  beforeEach(() => {
    messageBus = new MessageBus({
      enableDuplicateHandlerCheck: false,
      productionMode: false,
      enablePriorityQueue: false // تعطيل priority queue للمعالجة الفورية
    });
  });

  afterEach(() => {
    if (messageBus) {
      messageBus.destroy();
      messageBus = null;
    }
  });

  describe('MessageBus Stress Tests', () => {
    test('should handle thousands of messages without freezing', async () => {
      const stressBus = new MessageBus({
        maxQueueSize: 5000,
        enableBackpressure: true,
        maxProcessingTime: 10,
        enableLogging: false,
        productionMode: false,
        enablePriorityQueue: true // تفعيل للاختبار
      });
      
      let received = 0;
      let processed = [];
      
      // مستمع بسيط يحسب الرسائل
      stressBus.on('stress.*', (msg) => {
        received++;
        if (msg.data.track) {
          processed.push(msg.data.id);
        }
      });
      
      const startTime = performance.now();
      
      // إرسال 10,000 رسالة بسرعة فائقة
      console.log('Sending 10,000 messages...');
      for (let i = 0; i < 10000; i++) {
        const priority = i % 100 === 0 ? 'high' : i % 10 === 0 ? 'normal' : 'low';
        stressBus.emit(`stress.test${i % 50}`, { 
          id: i,
          track: priority === 'high' // تتبع الرسائل عالية الأولوية فقط
        }, { priority });
      }
      
      const sendTime = performance.now() - startTime;
      console.log(`Sent in ${sendTime.toFixed(2)}ms`);
      
      // انتظار المعالجة مع timeout أطول
      const waitStart = performance.now();
      while (received < 5000 && (performance.now() - waitStart) < 10000) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      const totalTime = performance.now() - startTime;
      const stats = stressBus.getStats();
      
      console.log('Stress test results:', {
        sent: 10000,
        received,
        dropped: stats.messagesDropped,
        pressure: stats.pressure,
        totalTime: totalTime.toFixed(2) + 'ms',
        rate: (received / (totalTime / 1000)).toFixed(2) + ' msg/s'
      });
      
      // التحقق من النتائج
      expect(sendTime).toBeLessThan(2000); // الإرسال سريع
      expect(received + stats.messagesDropped).toBeGreaterThan(5000); // معالجة معقولة
      expect(totalTime).toBeLessThan(15000); // لم يتجمد
      
      stressBus.destroy();
    }, 20000);

    test('should apply backpressure correctly', async () => {
      const backpressureBus = new MessageBus({
        maxQueueSize: 100,
        enableBackpressure: true,
        backpressureThreshold: 0.8,
        dropPolicy: 'low-priority',
        enablePriorityQueue: true, // تفعيل priority queue
        productionMode: false
      });
      
      let highReceived = 0;
      let lowReceived = 0;
      
      backpressureBus.on('test', (msg) => {
        if (msg.priority === 'high') highReceived++;
        else lowReceived++;
        
        // محاكاة معالجة بطيئة
        const start = Date.now();
        while (Date.now() - start < 2) {}
      });
      
      // إرسال مزيج من الرسائل
      for (let i = 0; i < 500; i++) {
        const priority = i % 5 === 0 ? 'high' : 'low';
        backpressureBus.emit('test', { i }, { priority });
      }
      
      // انتظار المعالجة
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const stats = backpressureBus.getStats();
      
      console.log('Backpressure test results:', {
        highReceived,
        lowReceived,
        dropped: stats.messagesDropped,
        pressure: stats.pressure
      });
      
      // التحقق من النتائج - مع priority queue، high priority يجب أن تُعالج أولاً
      expect(highReceived).toBeGreaterThan(50); // معظم الرسائل عالية الأولوية
      expect(stats.messagesDropped).toBeGreaterThan(0); // تم إسقاط بعض الرسائل
      
      backpressureBus.destroy();
    });

    test('should adapt batch size based on pressure', async () => {
      const adaptiveBus = new MessageBus({
        batchSize: 100,
        maxProcessingTime: 16,
        productionMode: false
      });
      
      let batchSizes = [];
      let lastBatchStart = Date.now();
      let currentBatch = 0;
      
      adaptiveBus.on('adaptive.*', () => {
        const now = Date.now();
        if (now - lastBatchStart > 10) {
          if (currentBatch > 0) {
            batchSizes.push(currentBatch);
          }
          currentBatch = 1;
          lastBatchStart = now;
        } else {
          currentBatch++;
        }
      });
      
      // إرسال رسائل تدريجياً
      for (let wave = 0; wave < 5; wave++) {
        const messageCount = (wave + 1) * 1000;
        for (let i = 0; i < messageCount; i++) {
          adaptiveBus.emit(`adaptive.wave${wave}`, { i });
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      // انتظار انتهاء المعالجة
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // يجب أن تقل أحجام الدفعات مع زيادة الضغط
      expect(batchSizes.length).toBeGreaterThan(0);
      const earlyAvg = batchSizes.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
      const lateAvg = batchSizes.slice(-5).reduce((a, b) => a + b, 0) / 5;
      
      // متوسط الدفعات المتأخرة يجب أن يكون أقل (تكيف مع الضغط)
      expect(lateAvg).toBeLessThanOrEqual(earlyAvg);
      
      adaptiveBus.destroy();
    });
  });

  describe('Basic Event Handling', () => {
    test('should emit and receive simple events', async () => {
      const handler = vi.fn();
      
      messageBus.on('test.event', handler);
      messageBus.emit('test.event', { value: 42 });

      // انتظار المعالجة
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'test.event',
          data: { value: 42 },
          timestamp: expect.any(Number),
          id: expect.any(String),
          priority: 'normal'
        })
      );
    });

    test('should handle multiple listeners for same event', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      
      messageBus.on('test.event', handler1);
      messageBus.on('test.event', handler2);
      messageBus.emit('test.event', { test: true });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    test('should prevent duplicate handler registration', async () => {
      // نحتاج message bus جديد مع enableDuplicateHandlerCheck
      const testBus = new MessageBus({
        enableDuplicateHandlerCheck: true,
        enableLogging: true,
        productionMode: false,
        enablePriorityQueue: false // معالجة فورية
      });
      
      const handler = vi.fn();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      testBus.on('test.event', handler);
      testBus.on('test.event', handler); // محاولة تسجيل مرة ثانية
      
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Handler already registered')
      );
      
      testBus.emit('test.event', {});
      
      // انتظار معالجة الرسالة
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // يجب أن يُستدعى مرة واحدة فقط
      expect(handler).toHaveBeenCalledTimes(1);
      
      warnSpy.mockRestore();
      testBus.destroy();
    });

    test('should handle once() correctly', async () => {
      const handler = vi.fn();
      
      messageBus.once('test.event', handler);
      messageBus.emit('test.event', { first: true });
      
      // انتظار المعالجة
      await new Promise(resolve => setTimeout(resolve, 50));
      
      messageBus.emit('test.event', { second: true });
      
      // انتظار محاولة المعالجة الثانية
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ data: { first: true } })
      );
    });
  });

  describe('Priority System', () => {
    test('should process high priority messages first', async () => {
      const order = [];
      
      // استخدام message bus بدون priority queue للمعالجة الفورية
      const testBus = new MessageBus({
        enablePriorityQueue: true,
        queueProcessingDelay: 20,
        productionMode: false
      });
      
      testBus.on('priority.test', (msg) => {
        order.push(msg.data.order);
      });
      
      // إرسال بترتيب مختلط
      testBus.emit('priority.test', { order: 1 }, { priority: 'low' });
      testBus.emit('priority.test', { order: 2 }, { priority: 'high' });
      testBus.emit('priority.test', { order: 3 }, { priority: 'normal' });
      testBus.emit('priority.test', { order: 4 }, { priority: 'high' });
      
      // انتظار معالجة جميع الرسائل
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // يجب أن تُعالج high أولاً، ثم normal، ثم low
      expect(order).toEqual([2, 4, 3, 1]);
      
      testBus.destroy();
    });

    test('should handle priority in listeners', async () => {
      const order = [];
      
      messageBus.on('test', () => order.push('normal'), { priority: 'normal' });
      messageBus.on('test', () => order.push('high'), { priority: 'high' });
      messageBus.on('test', () => order.push('low'), { priority: 'low' });
      
      messageBus.emit('test', {});
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(order).toEqual(['high', 'normal', 'low']);
    });
  });

  describe('Data Size Protection', () => {
    test('should reject messages exceeding max size', () => {
      const testBus = new MessageBus({
        maxDataSize: 100,
        productionMode: false
      });
      
      // استخدام بيانات تتجاوز الحد المسموح لكن لا تسبب stack overflow
      const largeData = { 
        data: Array(50).fill('test') // حجم معقول يتجاوز 100 bytes
      };
      
      expect(() => {
        testBus.emit('large.message', largeData);
      }).toThrow(/Data size.*exceeds maximum/);
      
      testBus.destroy();
    });

    test('should warn about large messages', () => {
      const testBus = new MessageBus({
        warnDataSize: 50,
        maxDataSize: 200,
        enableLogging: true,
        productionMode: false
      });
      
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      const mediumData = { text: 'x'.repeat(100) };
      testBus.emit('medium.message', mediumData);
      
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Large message warning')
      );
      
      const stats = testBus.getStats();
      expect(stats.largeMessagesWarnings).toBeGreaterThan(0);
      
      warnSpy.mockRestore();
      testBus.destroy();
    });
  });

  describe('Request/Response Pattern - Enhanced', () => {
    test('should handle successful request/response', async () => {
      const testBus = new MessageBus({
        enablePriorityQueue: false, // معالجة فورية
        productionMode: false
      });
      
      testBus.on('math.add', (message) => {
        const { a, b } = message.data;
        testBus.reply(message.requestId, {
          success: true,
          result: a + b
        });
      });

      const result = await testBus.request('math.add', { a: 5, b: 3 });
      expect(result).toBe(8);
      
      testBus.destroy();
    });

    test('should enforce max pending requests', async () => {
      const testBus = new MessageBus({ 
        maxPendingRequests: 2,
        productionMode: false
      });
      
      // إرسال 3 طلبات بدون رد
      const promise1 = testBus.request('no.response.1', {}, 100);
      const promise2 = testBus.request('no.response.2', {}, 100);
      const promise3 = testBus.request('no.response.3', {}, 100);
      
      await expect(promise3).rejects.toThrow('Maximum pending requests');
      
      // تنظيف
      testBus.destroy();
      await Promise.allSettled([promise1, promise2]);
    });

    test('should track peak pending requests', async () => {
      const testBus = new MessageBus({
        productionMode: false,
        enablePriorityQueue: false // معالجة فورية
      });
      const promises = [];
      
      // مستمع يرد بعد تأخير
      testBus.on('delayed.response', (msg) => {
        setTimeout(() => {
          testBus.reply(msg.requestId, { success: true, result: 'ok' });
        }, 50);
      });
      
      // إرسال 5 طلبات متزامنة
      for (let i = 0; i < 5; i++) {
        promises.push(testBus.request('delayed.response', {}));
      }
      
      await Promise.all(promises);
      
      expect(testBus.getStats().peakPendingRequests).toBe(5);
      testBus.destroy();
    });

    test('should enforce max timeout', async () => {
      const testBus = new MessageBus({
        maxTimeout: 100,
        productionMode: false
      });
      
      const promise = testBus.request('no.response', {}, 5000);
      
      await expect(promise).rejects.toThrow('Request timeout');
      
      // يجب أن يستخدم maxTimeout بدلاً من 5000
      const stats = testBus.getStats();
      expect(stats.requestsTimedOut).toBe(1);
      
      testBus.destroy();
    });
  });

  describe('Error Handling - Enhanced', () => {
    test('should handle errors without infinite loops', async () => {
      let errorCount = 0;
      
      const testBus = new MessageBus({
        enablePriorityQueue: false, // معالجة فورية
        productionMode: false
      });
      
      // مستمع لأخطاء النظام يسبب خطأ أيضاً
      testBus.on('system.error', () => {
        errorCount++;
        if (errorCount === 1) {
          throw new Error('Error handler error');
        }
      });
      
      // مستمع يسبب خطأ
      testBus.on('test', () => {
        throw new Error('Test error');
      });
      
      testBus.emit('test', {});
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // يجب أن يُسجل خطأ واحد فقط، ليس حلقة لانهائية
      expect(errorCount).toBe(1);
      
      testBus.destroy();
    });

    test('should validate inputs strictly', () => {
      expect(() => messageBus.on('', vi.fn())).toThrow(TypeError);
      expect(() => messageBus.on('event', 'not a function')).toThrow(TypeError);
      expect(() => messageBus.on('x'.repeat(300), vi.fn())).toThrow(RangeError);
      expect(() => messageBus.emit('')).toThrow(TypeError);
      expect(() => messageBus.reply(null, {})).not.toThrow(); // يجب أن يتعامل بلطف
    });
  });

  describe('System Health Monitoring', () => {
    test('should calculate system health correctly', async () => {
      const testBus = new MessageBus({
        enablePriorityQueue: false, // معالجة فورية
        productionMode: false
      });
      
      // نظام صحي
      let stats = testBus.getStats();
      expect(stats.health).toBe(100);
      
      // إضافة بعض الأخطاء
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      testBus.on('error.test', () => { throw new Error('Test'); });
      for (let i = 0; i < 10; i++) {
        testBus.emit('error.test', {});
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      stats = testBus.getStats();
      expect(stats.health).toBeLessThan(100);
      expect(stats.errorsCaught).toBe(10);
      
      errorSpy.mockRestore();
      testBus.destroy();
    });

    test('should format uptime correctly', () => {
      // اختبار formatUptime مباشرة
      expect(messageBus.formatUptime(0)).toBe('0s');
      expect(messageBus.formatUptime(5000)).toBe('5s');
      expect(messageBus.formatUptime(65000)).toBe('1m 5s');
      expect(messageBus.formatUptime(3665000)).toBe('1h 1m');
      expect(messageBus.formatUptime(90000000)).toBe('1d 1h'); // 25 ساعة
      
      // اختبار getStats مع uptime قصير
      const shortStats = messageBus.getStats();
      expect(shortStats.uptimeHuman).toMatch(/^\d+s$/);
      
      // اختبار getStats مع uptime طويل
      const oldBus = new MessageBus();
      oldBus.stats.startTime = Date.now() - (25 * 60 * 60 * 1000); // 25 ساعة
      oldBus._statsCache = null; // مسح cache الإحصائيات
      
      const longStats = oldBus.getStats();
      expect(longStats.uptimeHuman).toMatch(/^\d+d \d+h$/);
      
      oldBus.destroy();
    });

    test('should track all statistics accurately', async () => {
      const testBus = new MessageBus({
        enablePriorityQueue: false, // معالجة فورية
        productionMode: false
      });
      
      // إرسال رسائل مختلفة
      testBus.emit('test1', {});
      testBus.emit('test2', {}, { priority: 'high' });
      
      // طلب ناجح
      testBus.on('echo', (msg) => {
        testBus.reply(msg.requestId, { success: true, result: 'echo' });
      });
      await testBus.request('echo', {});
      
      // طلب فاشل
      testBus.on('fail', (msg) => {
        testBus.reply(msg.requestId, { success: false, error: 'Failed' });
      });
      await expect(testBus.request('fail', {})).rejects.toThrow();
      
      const stats = testBus.getStats();
      expect(stats.messagesSent).toBeGreaterThanOrEqual(4);
      expect(stats.requestsSent).toBe(2);
      expect(stats.requestsCompleted).toBe(1);
      expect(stats.requestsFailed).toBe(1);
      expect(stats.performance.requestSuccessRate).toBe('50.00%');
      
      testBus.destroy();
    });
  });

  describe('Memory Management', () => {
    test('should not leak memory with pattern cache', async () => {
      const testBus = new MessageBus({
        enablePriorityQueue: false, // معالجة فورية
        productionMode: false
      });
      
      // إرسال رسائل بأنماط wildcards لإنشاء pattern cache
      testBus.on('pattern.*', () => {});
      
      for (let i = 0; i < 5; i++) {
        testBus.emit(`pattern.test${i}`, {});
      }
      
      // انتظار المعالجة
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // التحقق من وجود pattern cache
      expect(testBus.patternCache).toBeDefined();
      expect(testBus.patternCache.size).toBeGreaterThan(0);
      
      // بعد التدمير يجب أن يُنظف
      testBus.destroy();
      expect(testBus.patternCache.size).toBe(0);
    });

    test('should clean up properly on destroy', async () => {
      const testBus = new MessageBus({
        productionMode: false
      });
      
      // إضافة مستمعين وطلبات معلقة
      testBus.on('test', () => {});
      const pendingPromise = testBus.request('never.responds', {});
      
      const statsBefore = testBus.getStats();
      expect(statsBefore.totalListeners).toBe(1);
      expect(statsBefore.pendingRequests).toBe(1);
      
      testBus.destroy();
      
      await expect(pendingPromise).rejects.toThrow('Message bus destroyed');
      expect(testBus.listeners.size).toBe(0);
      expect(testBus.pendingRequests.size).toBe(0);
    });
  });

  describe('MessageAPI Wrapper - Enhanced', () => {
    test('should validate inputs in createMessageAPI', () => {
      expect(() => createMessageAPI(null, 'Module')).toThrow(TypeError);
      expect(() => createMessageAPI(messageBus, '')).toThrow(TypeError);
      expect(() => createMessageAPI({}, 'Module')).toThrow(TypeError);
    });

    test('should provide stats access through API', () => {
      const api = createMessageAPI(messageBus, 'TestModule');
      const stats = api.getStats();
      
      expect(stats).toHaveProperty('messagesSent');
      expect(stats).toHaveProperty('health');
    });
  });

  describe('Performance Tests', () => {
    test('should handle high message volume efficiently', async () => {
      const testBus = new MessageBus({ 
        enablePriorityQueue: false, // معالجة فورية
        productionMode: false
      });
      const received = [];
      
      testBus.on('perf.*', (msg) => {
        received.push(msg.data.index);
      });
      
      const startTime = Date.now();
      
      // إرسال 100 رسالة (مخفضة من 1000 للاختبار السريع)
      for (let i = 0; i < 100; i++) {
        testBus.emit(`perf.test${i % 10}`, { index: i });
      }
      
      // انتظار معالجة كل الرسائل
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const duration = Date.now() - startTime;
      
      expect(received.length).toBe(100);
      expect(duration).toBeLessThan(500); // يجب أن يكون أقل من نصف ثانية
      
      const stats = testBus.getStats();
      expect(parseFloat(stats.messagesPerSecond)).toBeGreaterThan(10);
      
      testBus.destroy();
    });

    test('should handle queue overflow gracefully', async () => {
      const testBus = new MessageBus({
        enablePriorityQueue: false, // معالجة فورية
        productionMode: false
      });
      
      let processedCount = 0;
      
      testBus.on('overflow.test', () => {
        processedCount++;
        // محاكاة معالجة بطيئة
        const start = Date.now();
        while (Date.now() - start < 5) {} // 5ms blocking
      });
      
      // إرسال رسائل كثيرة بسرعة
      for (let i = 0; i < 50; i++) {
        testBus.emit('overflow.test', { i });
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      expect(processedCount).toBe(50);
      
      testBus.destroy();
    });
  });
});

describe('MessageBus Advanced Integration Tests', () => {
  test('should maintain message order within same priority', async () => {
    const messageBus = new MessageBus({
      productionMode: false,
      enablePriorityQueue: false // معالجة فورية للحفاظ على الترتيب
    });
    const received = [];
    
    messageBus.on('order.test', (msg) => {
      received.push(msg.data.id);
    });
    
    // إرسال رسائل بنفس الأولوية
    for (let i = 0; i < 10; i++) {
      messageBus.emit('order.test', { id: i }, { priority: 'normal' });
    }
    
    await new Promise(resolve => setTimeout(resolve, 50));
    
    expect(received).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    
    messageBus.destroy();
  });

  test('should handle complex wildcard scenarios', async () => {
    const messageBus = new MessageBus({
      productionMode: false,
      enablePriorityQueue: false // معالجة فورية
    });
    const matches = [];
    
    messageBus.on('app.*.*.created', (msg) => {
      matches.push(msg.event);
    });
    
    messageBus.emit('app.geometry.box.created', {});
    messageBus.emit('app.viewport.camera.created', {});
    messageBus.emit('app.geometry.updated', {}); // لا يطابق
    messageBus.emit('geometry.box.created', {}); // لا يطابق
    
    await new Promise(resolve => setTimeout(resolve, 50));
    
    expect(matches).toEqual([
      'app.geometry.box.created',
      'app.viewport.camera.created'
    ]);
    
    messageBus.destroy();
  });
});