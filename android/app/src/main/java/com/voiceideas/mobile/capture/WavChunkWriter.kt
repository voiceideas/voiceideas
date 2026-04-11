package com.voiceideas.mobile.capture

import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder

class WavChunkWriter(
    private val file: File,
    private val sampleRate: Int,
    private val channelCount: Int,
    private val bitsPerSample: Int,
) {
    private val output = RandomAccessFile(file, "rw")
    private var dataBytesWritten = 0L

    init {
        output.setLength(0L)
        writeHeader(0L)
    }

    fun write(buffer: ByteArray, count: Int) {
        output.write(buffer, 0, count)
        dataBytesWritten += count
    }

    fun close(): Long {
        writeHeader(dataBytesWritten)
        output.close()
        return dataBytesWritten
    }

    private fun writeHeader(dataSize: Long) {
        output.seek(0L)

        val byteRate = sampleRate * channelCount * bitsPerSample / 8
        val blockAlign = channelCount * bitsPerSample / 8
        val totalDataLen = dataSize + 36L
        val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray(Charsets.US_ASCII))
            putInt(totalDataLen.toInt())
            put("WAVE".toByteArray(Charsets.US_ASCII))
            put("fmt ".toByteArray(Charsets.US_ASCII))
            putInt(16)
            putShort(1)
            putShort(channelCount.toShort())
            putInt(sampleRate)
            putInt(byteRate)
            putShort(blockAlign.toShort())
            putShort(bitsPerSample.toShort())
            put("data".toByteArray(Charsets.US_ASCII))
            putInt(dataSize.toInt())
        }.array()

        output.write(header)
    }

    companion object {
        private const val WAV_HEADER_SIZE = 44L
        private const val COPY_BUFFER_SIZE_BYTES = 8_192

        fun merge(
            outputFile: File,
            chunkFiles: List<File>,
            sampleRate: Int,
            channelCount: Int,
            bitsPerSample: Int,
        ) {
            val mergedWriter = WavChunkWriter(outputFile, sampleRate, channelCount, bitsPerSample)
            val buffer = ByteArray(COPY_BUFFER_SIZE_BYTES)

            try {
                chunkFiles.forEach { chunkFile ->
                    if (!chunkFile.exists()) {
                        return@forEach
                    }

                    RandomAccessFile(chunkFile, "r").use { input ->
                        if (input.length() <= WAV_HEADER_SIZE) {
                            return@use
                        }

                        input.seek(WAV_HEADER_SIZE)
                        while (true) {
                            val read = input.read(buffer)
                            if (read <= 0) {
                                break
                            }
                            mergedWriter.write(buffer, read)
                        }
                    }
                }
            } finally {
                mergedWriter.close()
            }
        }
    }
}
