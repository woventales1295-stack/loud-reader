package com.devise.loudreader.app;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothServerSocket;
import android.bluetooth.BluetoothSocket;

import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.util.UUID;

import org.json.JSONObject;

/** Bluetooth (classic RFCOMM) version of SyncServer: length-prefixed JSON request/response frames. */
public class BtServer {
    public static final UUID SERVICE = UUID.fromString("5a1a3f0e-6c0b-4f6e-9d27-4c6f75645264");
    private static final int MAX_FRAME = 48 * 1024 * 1024;
    private final SyncServer.Handler handler;
    private BluetoothServerSocket server;
    private volatile boolean running;

    public BtServer(SyncServer.Handler h) { handler = h; }

    /** Starts listening; returns the Bluetooth name of this device. */
    public synchronized String start() throws IOException {
        stop();
        BluetoothAdapter ad = BluetoothAdapter.getDefaultAdapter();
        if (ad == null) throw new IOException("This device has no Bluetooth.");
        if (!ad.isEnabled()) throw new IOException("Bluetooth is turned off. Turn it on and try again.");
        server = ad.listenUsingInsecureRfcommWithServiceRecord("Loud Reader Sync", SERVICE);
        running = true;
        final BluetoothServerSocket ss = server;
        Thread t = new Thread(new Runnable() {
            public void run() {
                while (running) {
                    try {
                        final BluetoothSocket s = ss.accept();
                        Thread c = new Thread(new Runnable() { public void run() { serve(s); } }, "lr-bt-conn");
                        c.setDaemon(true);
                        c.start();
                    } catch (IOException e) { if (!running) break; }
                }
            }
        }, "lr-bt-accept");
        t.setDaemon(true);
        t.start();
        String name = "this device";
        try { String n = ad.getName(); if (n != null && n.length() > 0) name = n; } catch (SecurityException ignored) { }
        return name;
    }

    public synchronized void stop() {
        running = false;
        try { if (server != null) server.close(); } catch (IOException ignored) { }
        server = null;
    }

    private void serve(BluetoothSocket s) {
        try {
            DataInputStream in = new DataInputStream(s.getInputStream());
            DataOutputStream out = new DataOutputStream(s.getOutputStream());
            while (running) {
                int len = in.readInt();
                if (len <= 0 || len > MAX_FRAME) break;
                byte[] buf = new byte[len];
                in.readFully(buf);
                SyncServer.Reply r;
                try {
                    JSONObject q = new JSONObject(new String(buf, "UTF-8"));
                    r = handler.handle(q.optString("m", "GET"), q.optString("t", "/"), q.optString("b", ""));
                } catch (Throwable t) { r = new SyncServer.Reply(500, "{\"error\":\"internal\"}"); }
                JSONObject resp = new JSONObject();
                resp.put("s", r.status);
                resp.put("x", r.text);
                byte[] b = resp.toString().getBytes("UTF-8");
                out.writeInt(b.length);
                out.write(b);
                out.flush();
            }
        } catch (Exception e) {
            // connection closed or broken
        }
        try { s.close(); } catch (IOException ignored) { }
    }
}
