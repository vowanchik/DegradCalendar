package com.partyup.app;
import android.content.SharedPreferences;
import android.net.Uri;
import android.content.Intent;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.media.AudioAttributes;
import android.media.MediaMetadataRetriever;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.os.Build;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;
import java.security.MessageDigest;
import java.util.Locale;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "PartyNative")
public class PartyNativePlugin extends Plugin {
    private SharedPreferences prefs() { return getContext().getSharedPreferences("partyup.private", 0); }
    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias("partyup.session")) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder("partyup.session", KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return ((KeyStore.SecretKeyEntry)store.getEntry("partyup.session", null)).getSecretKey();
    }
    @PluginMethod public void setToken(PluginCall call) {
        try {
            String value = call.getString("value"); if(value == null || value.length() > 1024) { call.reject("Неверная сессия"); return; }
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
            String encoded = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
            if (!prefs().edit().putString("token", encoded).commit()) throw new Exception("Storage unavailable"); call.resolve();
        } catch(Exception e) { call.reject("Не удалось защитить сессию в Android Keystore", e); }
    }
    @PluginMethod public void getToken(PluginCall call) {
        try {
            String value = prefs().getString("token", null); JSObject result = new JSObject();
            if(value != null) { String[] parts = value.split(":",2); Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP))); result.put("value",new String(cipher.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),StandardCharsets.UTF_8)); }
            call.resolve(result);
        } catch(Exception e) { prefs().edit().remove("token").apply(); call.reject("Сессия недоступна. Войдите заново.",e); }
    }
    @PluginMethod public void clearToken(PluginCall call) { prefs().edit().remove("token").apply(); call.resolve(); }
    private MediaPlayer preview;
    private String soundKey(PluginCall call) throws Exception {
        String scope=call.getString("scope"), kind=call.getString("kind");
        if(scope==null || scope.length()>1000 || kind==null || !kind.matches("invite|reply|decline|message|friend|cancel|reminder")) throw new Exception("Неверный запрос звука");
        return "sound."+digest((scope+":"+kind).getBytes(StandardCharsets.UTF_8));
    }
    private String digest(byte[] value) throws Exception {
        byte[] hash=MessageDigest.getInstance("SHA-256").digest(value); StringBuilder result=new StringBuilder();
        for(byte b:hash) result.append(String.format(Locale.ROOT,"%02x", b & 0xff)); return result.toString();
    }
    @PluginMethod public void setSound(PluginCall call) {
        try {
            String mapping=soundKey(call);
            if(Boolean.TRUE.equals(call.getBoolean("reset"))) { prefs().edit().remove(mapping).apply(); call.resolve(new JSObject()); return; }
            String data=call.getString("dataUrl"), name=call.getString("name");
            if(data==null || data.length()>2800000 || !data.matches("data:audio/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+") || name==null || name.length()>200 || !name.toLowerCase(Locale.ROOT).matches(".*\\.(wav|mp3|ogg|m4a|caf|aiff?)")) throw new Exception("Выберите звуковой файл до 2 МБ");
            byte[] bytes=Base64.decode(data.substring(data.indexOf(',')+1),Base64.DEFAULT);
            if(bytes.length>2*1024*1024) throw new Exception("Файл больше 2 МБ");
            String digest=digest((mapping+data).getBytes(StandardCharsets.UTF_8));
            String filename=digest+name.substring(name.lastIndexOf('.')).toLowerCase(Locale.ROOT);
            File directory=new File(getContext().getFilesDir(),"notification-sounds");
            if(!directory.exists() && !directory.mkdirs()) throw new Exception("Хранилище недоступно");
            File file=new File(directory,filename);
            try(FileOutputStream output=new FileOutputStream(file)) { output.write(bytes); }
            MediaMetadataRetriever metadata=new MediaMetadataRetriever();
            try {
                metadata.setDataSource(file.getAbsolutePath());
                long duration=Long.parseLong(metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));
                if(duration<=0 || duration>=30000) { file.delete(); throw new Exception("Длительность звука должна быть меньше 30 секунд"); }
            } finally { metadata.release(); }
            String channelId="partyup-"+call.getString("kind")+"-"+digest.substring(0,24);
            Uri uri=FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".fileprovider",file);
            for(String target:new String[]{"com.android.systemui","com.google.android.gms","android"}) getContext().grantUriPermission(target,uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);
            if(Build.VERSION.SDK_INT>=26) {
                NotificationChannel channel=new NotificationChannel(channelId,"PartyUp · "+call.getString("kind"),NotificationManager.IMPORTANCE_HIGH);
                AudioAttributes attrs=new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build();
                channel.setSound(uri,attrs); channel.enableVibration(true);
                getContext().getSystemService(NotificationManager.class).createNotificationChannel(channel);
            }
            prefs().edit().putString(mapping,filename).apply();
            JSObject result=new JSObject(); result.put("name",name); result.put("channelId",channelId); call.resolve(result);
        } catch(Exception e) { call.reject(e.getMessage(),e); }
    }
    @PluginMethod public void previewSound(PluginCall call) {
        try {
            String file=prefs().getString(soundKey(call),null);
            if(preview!=null) { preview.release(); preview=null; }
            preview=new MediaPlayer();
            preview.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build());
            if(file!=null) preview.setDataSource(new File(new File(getContext().getFilesDir(),"notification-sounds"),file).getAbsolutePath());
            else preview.setDataSource(getContext(),RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION));
            preview.setOnCompletionListener(player -> { player.release(); if(preview==player) preview=null; });
            preview.prepare(); preview.start(); call.resolve();
        } catch(Exception e) { if(preview!=null) { preview.release(); preview=null; } call.reject("Не удалось воспроизвести звук",e); }
    }
    @Override protected void handleOnDestroy() { if(preview!=null) { preview.release(); preview=null; } }
}
