import test from "node:test";
import assert from "node:assert/strict";
import { ThreadMutexManager } from "./thread-mutex.js";

test("ThreadMutexManager: đảm bảo xử lý tuần tự (FIFO) cho cùng một thread", async () => {
  const mutex = new ThreadMutexManager();
  const executionOrder: number[] = [];

  const task1 = mutex.runExclusive("thread-1", "task1", async () => {
    await new Promise((r) => setTimeout(r, 50));
    executionOrder.push(1);
    return 1;
  });

  const task2 = mutex.runExclusive("thread-1", "task2", async () => {
    await new Promise((r) => setTimeout(r, 10));
    executionOrder.push(2);
    return 2;
  });

  const task3 = mutex.runExclusive("thread-1", "task3", async () => {
    executionOrder.push(3);
    return 3;
  });

  await Promise.all([task1, task2, task3]);

  // Dù task2 và task3 có thời gian sleep ngắn hơn task1, task1 vẫn phải xong trước task2 rồi mới tới task3
  assert.deepEqual(executionOrder, [1, 2, 3]);
});

test("ThreadMutexManager: cho phép chạy song song độc lập giữa các thread khác nhau", async () => {
  const mutex = new ThreadMutexManager();
  const finishedThreads: string[] = [];

  const threadA = mutex.runExclusive("thread-A", "taskA", async () => {
    await new Promise((r) => setTimeout(r, 60));
    finishedThreads.push("A");
  });

  const threadB = mutex.runExclusive("thread-B", "taskB", async () => {
    await new Promise((r) => setTimeout(r, 10));
    finishedThreads.push("B");
  });

  await Promise.all([threadA, threadB]);

  // Thread B chạy nhanh hơn sẽ hoàn thành trước Thread A vì chúng ở 2 thread khác nhau
  assert.deepEqual(finishedThreads, ["B", "A"]);
});
