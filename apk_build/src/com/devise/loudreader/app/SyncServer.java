package com.devise.loudreader.app;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;

/** Tiny HTTP/1.1 server (text in, text out) used for Wi-Fi sync. Every request is forwarded to a Handler. */
public class SyncServer {
    public interface Handler { Reply handle(String method, String target, String body); }
    public static class Reply { public final int status; public final String text; public Reply(int s, String t) { status = s; text = t; } }

    private static final int MAX_BODY = 16 * 1024 * 1024;
    private final Handler handler;
    private ServerSocket server;
    private volatile boolean running;

    public SyncServer(Handler h) { handler = h; }

    public synchronized int start() throws IOException {
        stop();
        try { server = new ServerSocket(8765); } catch (IOException e) { server = new ServerSocket(0); }
        running = true;
        final ServerSocket ss = server;
        Thread t = new Thread(new Runnable() {
            public void run() {
                while (running) {
                    try {
                        final Socket s = ss.accept();
                        Thread c = new Thread(new Runnable() { public void run() { serve(s); } }, "lr-sync-conn");
                        c.setDaemon(true);
                        c.start();
                    } catch (IOException e) { if (!running) break; }
                }
            }
        }, "lr-sync-accept");
        t.setDaemon(true);
        t.start();
        return ss.getLocalPort();
    }

    public synchronized void stop() {
        running = false;
        try { if (server != null) server.close(); } catch (IOException ignored) { }
        server = null;
    }

    public static List<String> localIps() {
        List<String> out = new ArrayList<String>();
        try {
            Enumeration<NetworkInterface> en = NetworkInterface.getNetworkInterfaces();
            if (en == null) return out;
            for (NetworkInterface ni : Collections.list(en)) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (a instanceof Inet4Address && a.isSiteLocalAddress()) out.add(a.getHostAddress());
                }
            }
        } catch (Exception ignored) { }
        return out;
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (c != '\r') b.write(c);
            if (b.size() > 16384) throw new IOException("header too long");
        }
        if (c == -1 && b.size() == 0) return null;
        return new String(b.toByteArray(), "UTF-8");
    }

    private void serve(Socket s) {
        try {
            s.setSoTimeout(120000);
            InputStream in = s.getInputStream();
            OutputStream out = s.getOutputStream();
            String line = readLine(in);
            if (line == null || line.length() == 0) { s.close(); return; }
            String[] p = line.split(" ");
            if (p.length < 2) { s.close(); return; }
            String method = p[0], target = p[1];
            int len = 0;
            String h;
            while ((h = readLine(in)) != null && h.length() > 0) {
                int i = h.indexOf(':');
                if (i > 0 && h.substring(0, i).trim().equalsIgnoreCase("content-length")) {
                    try { len = Integer.parseInt(h.substring(i + 1).trim()); } catch (NumberFormatException e) { len = 0; }
                }
            }
            if (len < 0 || len > MAX_BODY) { write(out, 413, "{\"error\":\"too large\"}"); s.close(); return; }
            String body = "";
            if (len > 0) {
                byte[] buf = new byte[len];
                int got = 0;
                while (got < len) { int r = in.read(buf, got, len - got); if (r < 0) throw new IOException("short body"); got += r; }
                body = new String(buf, "UTF-8");
            }
            if (method.equals("OPTIONS")) { write(out, 204, ""); s.close(); return; }
            Reply r;
            try { r = handler.handle(method, target, body); } catch (Throwable t) { r = new Reply(500, "{\"error\":\"internal\"}"); }
            write(out, r.status, r.text);
            s.close();
        } catch (IOException e) {
            try { s.close(); } catch (IOException ignored) { }
        }
    }

    private static void write(OutputStream out, int status, String text) throws IOException {
        byte[] b = text.getBytes("UTF-8");
        String reason = status == 200 ? "OK" : status == 204 ? "No Content" : "Error";
        String head = "HTTP/1.1 " + status + " " + reason + "\r\n"
            + "Content-Type: text/plain; charset=utf-8\r\n"
            + "Content-Length: " + b.length + "\r\n"
            + "Access-Control-Allow-Origin: *\r\n"
            + "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
            + "Access-Control-Allow-Headers: *\r\n"
            + "Access-Control-Allow-Private-Network: true\r\n"
            + "Cache-Control: no-store\r\n"
            + "Connection: close\r\n\r\n";
        out.write(head.getBytes("UTF-8"));
        out.write(b);
        out.flush();
    }
}
