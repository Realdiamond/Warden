package com.andsv.child

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/**
 * On-device buffer of captured events waiting to reach the server. Everything is written here first
 * and only removed once the server confirms receipt, so a dropped connection never loses data.
 */
class Outbox private constructor(context: Context) :
    SQLiteOpenHelper(context.applicationContext, "andsv_outbox.db", null, 1) {

    data class Row(
        val id: Long,
        val clientId: String,
        val kind: String,
        val capturedAt: String,
        val payload: String,
    )

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE outbox (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                "client_id TEXT NOT NULL, " +
                "kind TEXT NOT NULL, " +
                "captured_at TEXT NOT NULL, " +
                "payload TEXT NOT NULL, " +
                "created_at INTEGER NOT NULL)",
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // v1 only so far.
    }

    @Synchronized
    fun enqueue(clientId: String, kind: String, capturedAt: String, payload: String) {
        val values = ContentValues().apply {
            put("client_id", clientId)
            put("kind", kind)
            put("captured_at", capturedAt)
            put("payload", payload)
            put("created_at", System.currentTimeMillis())
        }
        writableDatabase.insert("outbox", null, values)
    }

    /** The oldest buffered events, up to [limit], in capture order. */
    @Synchronized
    fun peek(limit: Int): List<Row> {
        val rows = ArrayList<Row>()
        readableDatabase.query(
            "outbox",
            arrayOf("id", "client_id", "kind", "captured_at", "payload"),
            null, null, null, null, "id ASC", limit.toString(),
        ).use { c ->
            while (c.moveToNext()) {
                rows.add(Row(c.getLong(0), c.getString(1), c.getString(2), c.getString(3), c.getString(4)))
            }
        }
        return rows
    }

    @Synchronized
    fun delete(ids: List<Long>) {
        if (ids.isEmpty()) return
        writableDatabase.execSQL("DELETE FROM outbox WHERE id IN (${ids.joinToString(",")})")
    }

    @Synchronized
    fun count(): Int =
        readableDatabase.rawQuery("SELECT COUNT(*) FROM outbox", null).use {
            if (it.moveToFirst()) it.getInt(0) else 0
        }

    companion object {
        @Volatile
        private var instance: Outbox? = null

        fun get(context: Context): Outbox =
            instance ?: synchronized(this) {
                instance ?: Outbox(context).also { instance = it }
            }
    }
}
