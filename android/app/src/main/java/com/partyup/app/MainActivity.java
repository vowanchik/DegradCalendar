package com.partyup.app;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle state) {
        registerPlugin(PartyNativePlugin.class);
        super.onCreate(state);
    }
}
