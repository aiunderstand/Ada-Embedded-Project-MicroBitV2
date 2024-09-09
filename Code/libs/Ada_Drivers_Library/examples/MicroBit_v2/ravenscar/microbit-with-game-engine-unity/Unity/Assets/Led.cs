using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class Led : MonoBehaviour
{
    Light led;

    private void Start()
    {
        led = GetComponentInChildren<Light>();
        Switch(false);
    }
    
    public void Switch(bool state)
    {
        led.enabled = state;
    }
}

