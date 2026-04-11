package com.voiceideas.mobile;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.voiceideas.mobile.capture.SecureCapturePlugin;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(SecureCapturePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
