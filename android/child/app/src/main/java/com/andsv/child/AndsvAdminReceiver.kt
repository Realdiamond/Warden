package com.andsv.child

import android.app.admin.DeviceAdminReceiver

/** Device-admin component — required for remote lock (and, as device owner, for remote unlock). */
class AndsvAdminReceiver : DeviceAdminReceiver()
