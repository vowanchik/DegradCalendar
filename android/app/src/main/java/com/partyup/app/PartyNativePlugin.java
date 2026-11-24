package com.partyup.app;
import android.Manifest;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CalendarContract;
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

@CapacitorPlugin(name = "PartyNative", permissions = {
    @Permission(alias = "calendar", strings = {Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR})
})
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
    @PluginMethod public void saveCalendar(PluginCall call) {
        if(getPermissionState("calendar") != PermissionState.GRANTED) { requestPermissionForAlias("calendar",call,"calendarPermission"); return; } saveEvent(call);
    }
    @PermissionCallback private void calendarPermission(PluginCall call) {
        if(getPermissionState("calendar") == PermissionState.GRANTED) saveEvent(call);
        else call.reject("Разрешите доступ к календарю в настройках телефона. Ответ на приглашение уже сохранён.");
    }
    private void saveEvent(PluginCall call) {
        try {
            String eventKey=call.getString("key"), title=call.getString("title"); Double starts=call.getDouble("startMs"), ends=call.getDouble("endMs");
            if(eventKey==null || title==null || starts==null || ends==null || ends<=starts) { call.reject("Неверные данные встречи"); return; }
            long calendarId=-1;
            try(Cursor calendars=getContext().getContentResolver().query(CalendarContract.Calendars.CONTENT_URI,new String[]{CalendarContract.Calendars._ID},CalendarContract.Calendars.VISIBLE+"=1 AND "+CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL+">=?",new String[]{String.valueOf(CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR)},CalendarContract.Calendars.IS_PRIMARY+" DESC")) {
                if(calendars!=null && calendars.moveToFirst()) calendarId=calendars.getLong(0);
            }
            if(calendarId<0) { call.reject("На телефоне нет календаря для записи. Добавьте календарь в системном приложении."); return; }
            ContentValues values=new ContentValues(); values.put(CalendarContract.Events.CALENDAR_ID,calendarId); values.put(CalendarContract.Events.TITLE,title);
            values.put(CalendarContract.Events.DTSTART,starts.longValue()); values.put(CalendarContract.Events.DTEND,ends.longValue()); values.put(CalendarContract.Events.EVENT_TIMEZONE,"UTC");
            values.put(CalendarContract.Events.DESCRIPTION,call.getString("notes","")); values.put(CalendarContract.Events.EVENT_LOCATION,call.getString("location","")); values.put(CalendarContract.Events.HAS_ALARM,1);
            String mapping="calendar."+eventKey; long id=prefs().getLong(mapping,-1);
            if(id>=0 && getContext().getContentResolver().update(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI,id),values,null,null)==0) id=-1;
            if(id<0) { Uri uri=getContext().getContentResolver().insert(CalendarContract.Events.CONTENT_URI,values); if(uri==null) throw new Exception("Calendar insert failed"); id=ContentUris.parseId(uri); prefs().edit().putLong(mapping,id).apply(); }
            getContext().getContentResolver().delete(CalendarContract.Reminders.CONTENT_URI,CalendarContract.Reminders.EVENT_ID+"=?",new String[]{String.valueOf(id)});
            ContentValues reminder=new ContentValues(); reminder.put(CalendarContract.Reminders.EVENT_ID,id); reminder.put(CalendarContract.Reminders.MINUTES,15); reminder.put(CalendarContract.Reminders.METHOD,CalendarContract.Reminders.METHOD_ALERT);
            getContext().getContentResolver().insert(CalendarContract.Reminders.CONTENT_URI,reminder); call.resolve();
        } catch(Exception e) { call.reject("Не удалось сохранить событие в календарь",e); }
    }
    @PluginMethod public void removeCalendar(PluginCall call) {
        String eventKey=call.getString("key"); if(eventKey==null) { call.reject("Неверный идентификатор"); return; }
        String mapping="calendar."+eventKey; long id=prefs().getLong(mapping,-1); if(id<0) { call.resolve(); return; }
        if(getPermissionState("calendar")!=PermissionState.GRANTED) { call.reject("Нет доступа к календарю"); return; }
        try { getContext().getContentResolver().delete(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI,id),null,null); prefs().edit().remove(mapping).apply(); call.resolve(); }
        catch(Exception e) { call.reject("Не удалось удалить отменённую встречу",e); }
    }
}
