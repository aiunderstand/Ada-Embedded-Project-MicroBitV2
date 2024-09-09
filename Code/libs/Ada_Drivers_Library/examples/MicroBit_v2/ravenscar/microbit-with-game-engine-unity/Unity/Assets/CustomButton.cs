using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class CustomButton : MonoBehaviour
{
    // Start is called before the first frame update
    float startHeight;
    public float maxTravelDistance = 0.30f;
    float pressedHeight;
    public bool isPressed =false;
    public bool isDown = false;
    public bool isUp = false;

    private void Start()
    {
        startHeight = transform.localPosition.y;
        pressedHeight = startHeight - maxTravelDistance;
        isPressed = false;
    }

    public void Press(bool state)
    {
        isPressed = state;

        if (isPressed)
            transform.localPosition = new Vector3(transform.localPosition.x, pressedHeight, transform.localPosition.z);
        else
            transform.localPosition = new Vector3(transform.localPosition.x, startHeight, transform.localPosition.z);
    }
}
